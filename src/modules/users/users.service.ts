import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { uploadAvatar, deleteAvatar } from '../../lib/cloudinary.js';
import { hashPassword, verifyPassword } from '../../services/password.service.js';
import {
  generateTempPassword,
  generateInviteToken,
} from '../../services/token.service.js';
import { sendInviteEmail } from '../../services/email.service.js';
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
} from '../../lib/errors.js';
import type { Role } from '@prisma/client';

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

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
) {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true },
  });

  if (existing && existing.deletedAt === null) {
    throw new ConflictError('Email already in use');
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const { hashedToken: inviteTokenHash } = generateInviteToken();
  const inviteTokenExpiry = new Date(
    Date.now() + env.INVITE_TOKEN_EXPIRY_DAYS * 24 * 60 * 60_000,
  );

  const user = await prisma.user.create({
    data: {
      email,
      name,
      role,
      passwordHash,
      mustChangePassword: true,
      inviteTokenHash,
      inviteTokenExpiry,
    },
    select: SAFE_USER_SELECT,
  });

  await sendInviteEmail(email, tempPassword);

  return user;
}

export async function resendInvite(userId: string, requestedByUserId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  if (!user.mustChangePassword) {
    throw new ConflictError('User is already active and has logged in');
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const { hashedToken: inviteTokenHash } = generateInviteToken();
  const inviteTokenExpiry = new Date(
    Date.now() + env.INVITE_TOKEN_EXPIRY_DAYS * 24 * 60 * 60_000,
  );

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      inviteTokenHash,
      inviteTokenExpiry,
      mustChangePassword: true,
    },
    select: SAFE_USER_SELECT,
  });

  await sendInviteEmail(user.email, tempPassword);

  return updated;
}

export async function listUsers(page: number, limit: number) {
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: SAFE_USER_SELECT,
    }),
    prisma.user.count({ where: { deletedAt: null } }),
  ]);

  return { users, total, page, limit };
}

export async function getUserById(id: string) {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: SAFE_USER_SELECT,
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  return user;
}

export async function updateUser(
  userId: string,
  data: { name?: string; role?: Role },
  requestedByUserId: string,
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

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: SAFE_USER_SELECT,
  });

  return updated;
}

export async function deactivateUser(
  userId: string,
  requestedByUserId: string,
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

  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
      select: SAFE_USER_SELECT,
    }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);

  return updated;
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

export async function changeOwnPassword(
  userId: string,
  sessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
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

  // Delete all sessions except current
  await prisma.session.deleteMany({
    where: { userId, id: { not: sessionId } },
  });
}
