import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { uploadAvatar, deleteAvatar } from '../../lib/cloudinary.js';
import { signAccessToken, generateRefreshToken, hashToken } from '../../services/token.service.js';
import { hashPassword, verifyPassword } from '../../services/password.service.js';
import { generateInviteToken } from '../../services/token.service.js';
import { sendInviteEmail, sendAssetRecoveryNotification } from '../../services/email.service.js';
import { createAuditLog, type AuditParams } from '../../services/audit.service.js';
import { emitEvent } from '../../services/events.service.js';
import { csvList } from '../../lib/validate.js';
import { getOrCreateDepartment } from '../departments/departments.service.js';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
} from '../../lib/errors.js';
import type { Role } from '@prisma/client';

type Ctx = Pick<AuditParams, 'ipAddress' | 'userAgent'>;

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  department: true,
  avatarUrl: true,
  isActive: true,
  inviteTokenHash: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  teamMemberships: { select: { team: { select: { id: true, name: true } } } },
} as const satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof SAFE_USER_SELECT }>;

export type UserStatus = 'ACTIVE' | 'PENDING' | 'DEACTIVATED';

/** ACTIVE: can sign in. PENDING: invited, has not accepted yet. DEACTIVATED: disabled by an admin. */
export function userStatus(u: { isActive: boolean; inviteTokenHash: string | null }): UserStatus {
  if (u.isActive) return 'ACTIVE';
  return u.inviteTokenHash ? 'PENDING' : 'DEACTIVATED';
}

function serializeUser(u: UserRow) {
  const { inviteTokenHash, teamMemberships, ...rest } = u;
  return {
    ...rest,
    status: userStatus(u),
    teams: teamMemberships.map((m) => m.team),
  };
}

const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  department: true,
  location: true,
  bio: true,
  avatarUrl: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function assertNotLastSuperAdmin(excludeUserId: string): Promise<void> {
  const count = await prisma.user.count({
    where: {
      role: 'SUPER_ADMIN',
      isActive: true,
      deletedAt: null,
      id: { not: excludeUserId },
    },
  });
  if (count === 0) {
    throw new ConflictError('Cannot remove the last active SUPER_ADMIN');
  }
}

export async function inviteUser(
  email: string,
  name: string,
  role: Role,
  invitedByUserId: string,
  department?: string,
  ctx: Ctx = {},
) {
  const departmentName = department ? (await getOrCreateDepartment(department)).name : undefined;
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true },
  });

  if (existing && existing.deletedAt === null) {
    throw new ConflictError('Email already in use');
  }

  const { plainToken, hashedToken: inviteTokenHash } = generateInviteToken();
  const inviteTokenExpiry = new Date(
    Date.now() + env.INVITE_TOKEN_EXPIRY_DAYS * 24 * 60 * 60_000,
  );
  // Set an unusable placeholder password — user sets their real password via the invite link
  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
  const inviteUrl = `${env.FRONTEND_URL}/accept-invite?token=${plainToken}`;

  const user = await prisma.user.create({
    data: {
      email,
      name,
      role,
      department: departmentName,
      passwordHash,
      isActive: false, // inactive until they accept the invite
      mustChangePassword: false,
      inviteTokenHash,
      inviteTokenExpiry,
    },
    select: SAFE_USER_SELECT,
  });

  sendInviteEmail(email, inviteUrl).catch((err) => {
    logger.error({ err, email }, 'Failed to send invite email');
  });

  await createAuditLog({ userId: invitedByUserId, action: 'CREATE', targetType: 'USER', targetId: user.id, metadata: { invited: true, role }, ...ctx });
  emitEvent('user.invited', { id: user.id, email: user.email, role });

  return serializeUser(user);
}

export async function resendInvite(userId: string, requestedByUserId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  if (!user.inviteTokenHash) {
    throw new ConflictError('User has already accepted their invitation');
  }

  const { plainToken, hashedToken: inviteTokenHash } = generateInviteToken();
  const inviteTokenExpiry = new Date(
    Date.now() + env.INVITE_TOKEN_EXPIRY_DAYS * 24 * 60 * 60_000,
  );
  const inviteUrl = `${env.FRONTEND_URL}/accept-invite?token=${plainToken}`;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      inviteTokenHash,
      inviteTokenExpiry,
    },
    select: SAFE_USER_SELECT,
  });

  sendInviteEmail(user.email, inviteUrl).catch((err) => {
    logger.error({ err, email: user.email }, 'Failed to resend invite email');
  });

  return serializeUser(updated);
}

function buildUserWhere(filters: { search?: string; role?: string; status?: string; department?: string }): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [{ deletedAt: null }];
  if (filters.search) {
    const contains = { contains: filters.search, mode: 'insensitive' as const };
    and.push({ OR: [{ name: contains }, { email: contains }] });
  }
  const roles = csvList(filters.role);
  if (roles) and.push({ role: { in: roles.map((r) => r.toUpperCase()) as Role[] } });
  const departments = csvList(filters.department);
  if (departments) and.push({ OR: departments.map((d) => ({ department: { equals: d, mode: 'insensitive' as const } })) });
  const statuses = csvList(filters.status)?.map((s) => s.toUpperCase());
  if (statuses) {
    const ors: Prisma.UserWhereInput[] = [];
    if (statuses.includes('ACTIVE')) ors.push({ isActive: true });
    if (statuses.includes('PENDING')) ors.push({ isActive: false, inviteTokenHash: { not: null } });
    if (statuses.includes('DEACTIVATED')) ors.push({ isActive: false, inviteTokenHash: null });
    and.push({ OR: ors.length ? ors : [{ id: '__none__' }] });
  }
  return { AND: and };
}

export async function listUsers(
  page: number,
  limit: number,
  filters: { search?: string; role?: string; status?: string; department?: string } = {},
) {
  const skip = (page - 1) * limit;
  const where = buildUserWhere(filters);

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: SAFE_USER_SELECT,
    }),
    prisma.user.count({ where }),
  ]);

  return { users: users.map(serializeUser), total, page, limit };
}

/** Header cards and filter counts on the Users screen. */
export async function userStats() {
  const base: Prisma.UserWhereInput = { deletedAt: null };
  const [total, active, pending, deactivated, byRole] = await Promise.all([
    prisma.user.count({ where: base }),
    prisma.user.count({ where: { ...base, isActive: true } }),
    prisma.user.count({ where: { ...base, isActive: false, inviteTokenHash: { not: null } } }),
    prisma.user.count({ where: { ...base, isActive: false, inviteTokenHash: null } }),
    prisma.user.groupBy({ by: ['role'], where: base, _count: { _all: true } }),
  ]);
  const roles = ['SUPER_ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'].map((r) => ({
    value: r,
    count: byRole.find((b) => b.role === r)?._count._all ?? 0,
  }));
  return { total, active, pending, deactivated, roles };
}

/** Lightweight directory for "search registered user" pickers; available to any signed-in user. */
export async function lookupUsers(search: string | undefined, limit: number) {
  return prisma.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    },
    select: { id: true, name: true, email: true, role: true, avatarUrl: true },
    orderBy: { name: 'asc' },
    take: limit,
  });
}

export async function getUserById(id: string) {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: SAFE_USER_SELECT,
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  return serializeUser(user);
}

/** Everything the "User Details" dialog shows: profile, teams, assigned assets and shared credentials. */
export async function getUserDetails(id: string) {
  const base = await getUserById(id);
  const [assets, direct, viaTeams] = await Promise.all([
    prisma.asset.findMany({
      where: { assigneeId: id, deletedAt: null },
      select: { id: true, assetId: true, name: true, category: { select: { name: true } } },
    }),
    prisma.credentialAccess.findMany({
      where: { userId: id, credential: { deletedAt: null } },
      select: { permission: true, credential: { select: { id: true, friendlyName: true, credType: true } } },
    }),
    prisma.teamCredential.findMany({
      where: { team: { members: { some: { userId: id } } }, credential: { deletedAt: null } },
      select: { permission: true, credential: { select: { id: true, friendlyName: true, credType: true } } },
    }),
  ]);
  const shared = new Map<string, { id: string; friendlyName: string; credType: string; permission: string }>();
  const rank: Record<string, number> = { VIEW: 1, COPY: 2, EDIT: 3, MANAGE: 4 };
  for (const row of [...direct, ...viaTeams]) {
    const prev = shared.get(row.credential.id);
    if (!prev || rank[row.permission] > rank[prev.permission]) shared.set(row.credential.id, { ...row.credential, permission: row.permission });
  }
  return {
    ...base,
    assignedAssets: assets.map((a) => ({ id: a.id, assetId: a.assetId, name: a.name, category: a.category.name })),
    sharedCredentials: [...shared.values()],
  };
}

export async function updateUser(
  userId: string,
  data: { name?: string; email?: string; role?: Role; department?: string | null },
  requestedByUserId: string,
  ctx: Ctx = {},
) {
  const target = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
  });

  if (!target) {
    throw new NotFoundError('User not found');
  }

  if (data.role !== undefined) {
    // Self-demotion guard
    if (userId === requestedByUserId && data.role !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Cannot demote yourself');
    }

    // Cannot demote another SUPER_ADMIN
    if (
      target.role === 'SUPER_ADMIN' &&
      userId !== requestedByUserId &&
      data.role !== 'SUPER_ADMIN'
    ) {
      throw new ForbiddenError('Cannot demote another SUPER_ADMIN');
    }

    // Last SUPER_ADMIN safeguard
    if (target.role === 'SUPER_ADMIN' && data.role !== 'SUPER_ADMIN') {
      await assertNotLastSuperAdmin(userId);
    }
  }

  if (data.email !== undefined && data.email !== target.email) {
    const taken = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
    if (taken) throw new ConflictError('Email already in use');
  }

  let department: string | null | undefined;
  if (data.department !== undefined) {
    department = data.department === null ? null : (await getOrCreateDepartment(data.department)).name;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      name: data.name,
      email: data.email,
      role: data.role,
      ...(department !== undefined && { department }),
    },
    select: SAFE_USER_SELECT,
  });

  await createAuditLog({ userId: requestedByUserId, action: 'EDIT', targetType: 'USER', targetId: userId, ...ctx });
  return serializeUser(updated);
}

export async function deactivateUser(
  userId: string,
  requestedByUserId: string,
  ctx: Ctx = {},
) {
  if (userId === requestedByUserId) {
    throw new ForbiddenError('Cannot deactivate yourself');
  }

  const target = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
  });

  if (!target) {
    throw new NotFoundError('User not found');
  }

  if (target.role === 'SUPER_ADMIN') {
    throw new ForbiddenError('Cannot deactivate a SUPER_ADMIN');
  }

  const assigned = await prisma.asset.findMany({
    where: { assigneeId: userId, deletedAt: null },
    select: { id: true, assetId: true, name: true },
  });

  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
      select: SAFE_USER_SELECT,
    }),
    prisma.session.deleteMany({ where: { userId } }),
    // Flag every asset the user holds so admins can recover it.
    prisma.asset.updateMany({
      where: { assigneeId: userId, deletedAt: null },
      data: { recoveryRequestedAt: new Date() },
    }),
  ]);

  await createAuditLog({
    userId: requestedByUserId,
    action: 'EDIT',
    targetType: 'USER',
    targetId: userId,
    metadata: { deactivated: true, flaggedAssets: assigned.length },
    ...ctx,
  });
  emitEvent('user.deactivated', { id: userId, email: target.email, flaggedAssets: assigned.length });

  if (assigned.length > 0) {
    const admins = await prisma.user.findMany({
      where: { role: { in: ['SUPER_ADMIN', 'MANAGER'] }, isActive: true, deletedAt: null },
      select: { email: true },
    });
    for (const admin of admins) {
      sendAssetRecoveryNotification(admin.email, target.name, assigned).catch((err) => {
        logger.error({ err, to: admin.email }, 'Failed to send asset recovery notification');
      });
    }
  }

  return { user: serializeUser(updated), flaggedAssets: assigned.length };
}

export async function reactivateUser(userId: string, requestedByUserId: string, ctx: Ctx = {}) {
  const target = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: false, inviteTokenHash: null },
  });
  if (!target) throw new NotFoundError('Deactivated user not found');

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { isActive: true, failedAttempts: 0, lockedUntil: null },
    select: SAFE_USER_SELECT,
  });
  await createAuditLog({
    userId: requestedByUserId,
    action: 'EDIT',
    targetType: 'USER',
    targetId: userId,
    metadata: { reactivated: true },
    ...ctx,
  });
  return serializeUser(updated);
}

export async function getMyProfile(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: PROFILE_SELECT,
  });
  if (!user) throw new NotFoundError('User not found');
  return user;
}

export async function updateMyProfile(
  userId: string,
  data: { name?: string; phone?: string | null; department?: string | null; location?: string | null; bio?: string | null },
) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw new NotFoundError('User not found');

  return prisma.user.update({
    where: { id: userId },
    data,
    select: PROFILE_SELECT,
  });
}

export async function uploadUserAvatar(userId: string, buffer: Buffer) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, avatarPublicId: true },
  });
  if (!user) throw new NotFoundError('User not found');

  const { url, publicId } = await uploadAvatar(buffer, userId, user.avatarPublicId);

  return prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: url, avatarPublicId: publicId },
    select: PROFILE_SELECT,
  });
}

export async function deleteUserAvatar(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, avatarPublicId: true },
  });
  if (!user) throw new NotFoundError('User not found');
  if (!user.avatarPublicId) return;

  await deleteAvatar(user.avatarPublicId);
  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null, avatarPublicId: null },
  });
}

export async function hardDeleteUser(userId: string, requestedByUserId: string) {
  if (userId === requestedByUserId) {
    throw new ForbiddenError('Cannot delete yourself');
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      role: true,
      _count: {
        select: {
          credentials: { where: { deletedAt: null } },
          assets: { where: { deletedAt: null } },
        },
      },
    },
  });

  if (!user) throw new NotFoundError('User not found');

  if (user.role === 'SUPER_ADMIN') {
    throw new ForbiddenError('Cannot delete a SUPER_ADMIN');
  }

  if (user._count.credentials > 0 || user._count.assets > 0) {
    throw new ConflictError(
      `Cannot delete user: they own ${user._count.credentials} credential(s) and ${user._count.assets} asset(s). Reassign or delete these first.`,
    );
  }

  // Hard delete — cascades sessions, access records, audit logs via DB relations
  await prisma.user.delete({ where: { id: userId } });
}

export async function changeOwnPassword(
  userId: string,
  sessionId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  const valid = await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
  });

  // Rotate the current session so the new token has mustChangePassword: false
  await prisma.session.delete({ where: { id: sessionId } });

  // Delete all other sessions
  await prisma.session.deleteMany({ where: { userId } });

  const newRefreshToken = generateRefreshToken();
  const newSession = await prisma.session.create({
    data: {
      userId,
      refreshToken: hashToken(newRefreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60_000),
      lastActiveAt: new Date(),
    },
  });

  const accessToken = await signAccessToken({
    userId,
    role: user.role,
    sessionId: newSession.id,
    mustChangePassword: false,
  });

  return { accessToken, refreshToken: newRefreshToken };
}
