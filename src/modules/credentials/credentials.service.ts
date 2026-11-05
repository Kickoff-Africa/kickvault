import { randomInt } from 'node:crypto';
import { PermissionLevel, Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { checkCredentialAccess } from '../../middleware/requireResourceAccess.js';
import { grantCredentialAccess } from '../credential-access/credential-access.service.js';
import { createAuditLog, type AuditParams } from '../../services/audit.service.js';
import { assertRevealReauth } from '../../services/reauth.service.js';
import { emitEvent } from '../../services/events.service.js';
import { credentialVisibleTo, isPrivilegedRole, maxPermission } from '../../lib/access.js';
import { csvList } from '../../lib/validate.js';
import { NotFoundError } from '../../lib/errors.js';
import type {
  CreateCredentialInput,
  UpdateCredentialInput,
  ListCredentialsQuery,
  CredentialTypeValue,
} from './credentials.validation.js';

type Ctx = Pick<AuditParams, 'ipAddress' | 'userAgent'>;

const asDate = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);

const buildSelect = (userId: string) =>
  ({
    id: true,
    friendlyName: true,
    credType: true,
    systemHost: true,
    username: true,
    policyRef: true,
    expiresAt: true,
    currentVersion: true,
    createdById: true,
    createdAt: true,
    updatedAt: true,
    createdBy: { select: { id: true, name: true } },
    credentialAccess: { select: { userId: true, permission: true } },
    teamCredentials: {
      select: { permission: true, team: { select: { members: { where: { userId }, select: { userId: true } } } } },
    },
  }) satisfies Prisma.CredentialSelect;

type Row = Prisma.CredentialGetPayload<{ select: ReturnType<typeof buildSelect> }>;

function serialize(row: Row, userId: string, userRole: string) {
  const direct = row.credentialAccess.find((a) => a.userId === userId)?.permission;
  const viaTeams = row.teamCredentials.filter((t) => t.team.members.length > 0).map((t) => t.permission);
  const mine = isPrivilegedRole(userRole) ? PermissionLevel.MANAGE : maxPermission([direct, ...viaTeams]);
  const sharedWith = row.credentialAccess.filter((a) => a.userId !== row.createdById).length + row.teamCredentials.length;
  return {
    id: row.id,
    friendlyName: row.friendlyName,
    credType: row.credType,
    systemHost: row.systemHost,
    username: row.username,
    policyRef: row.policyRef,
    expiresAt: row.expiresAt,
    currentVersion: row.currentVersion,
    owner: row.createdBy,
    createdById: row.createdById,
    shareCount: sharedWith,
    myPermission: mine,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createCredential(data: CreateCredentialInput, createdById: string, ctx: Ctx = {}) {
  const encrypted = encrypt(data.secret);
  const credential = await prisma.credential.create({
    data: {
      friendlyName: data.friendlyName,
      credType: data.credType,
      systemHost: data.systemHost,
      username: data.username,
      policyRef: data.policyRef,
      encryptedValue: encrypted.encryptedValue,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      expiresAt: data.expiresAt ? asDate(data.expiresAt) : undefined,
      createdById,
      versions: {
        create: {
          version: 1,
          encryptedValue: encrypted.encryptedValue,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          createdById,
        },
      },
    },
    select: { id: true },
  });
  await grantCredentialAccess(credential.id, createdById, PermissionLevel.MANAGE);
  await createAuditLog({ userId: createdById, action: 'CREATE', targetType: 'CREDENTIAL', targetId: credential.id, ...ctx });
  emitEvent('credential.created', { id: credential.id, name: data.friendlyName, credType: data.credType });
  return getCredential(credential.id, createdById, 'SUPER_ADMIN');
}

function listWhere(userId: string, userRole: string, query?: ListCredentialsQuery): Prisma.CredentialWhereInput {
  const and: Prisma.CredentialWhereInput[] = [{ deletedAt: null }];
  if (!isPrivilegedRole(userRole)) and.push(credentialVisibleTo(userId));
  if (query?.search) {
    const contains = { contains: query.search, mode: 'insensitive' as const };
    and.push({ OR: [{ friendlyName: contains }, { systemHost: contains }, { username: contains }] });
  }
  const types = csvList(query?.credType);
  if (types) and.push({ credType: { in: types.map((t) => t.toUpperCase().replace(/[\s-]+/g, '_')) as CredentialTypeValue[] } });
  if (query?.expiring_within) {
    const days = parseInt(query.expiring_within.replace('d', ''), 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    and.push({ expiresAt: { lte: cutoff, gte: new Date() } });
  }
  return { AND: and };
}

export async function listCredentials(userId: string, userRole: string, query?: ListCredentialsQuery) {
  const rows = await prisma.credential.findMany({
    where: listWhere(userId, userRole, query),
    select: buildSelect(userId),
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => serialize(r, userId, userRole));
}

/** Counts per credential type for the filter dropdown (every type is listed, even with 0). */
export async function credentialFacets(userId: string, userRole: string) {
  const grouped = await prisma.credential.groupBy({
    by: ['credType'],
    where: listWhere(userId, userRole),
    _count: { _all: true },
  });
  const types: CredentialTypeValue[] = ['LOGIN', 'API_KEY', 'SSH_KEY', 'SOFTWARE_LICENSE', 'TOKEN', 'CERTIFICATE', 'OTHER'];
  return { types: types.map((t) => ({ value: t, count: grouped.find((g) => g.credType === t)?._count._all ?? 0 })) };
}

export async function getCredential(id: string, userId: string, userRole: string) {
  await checkCredentialAccess(userId, userRole, id, PermissionLevel.VIEW);
  const row = await prisma.credential.findFirst({ where: { id, deletedAt: null }, select: buildSelect(userId) });
  if (!row) throw new NotFoundError('Credential not found');
  return serialize(row, userId, userRole);
}

export async function updateCredential(id: string, data: UpdateCredentialInput, userId: string, userRole: string, ctx: Ctx = {}) {
  await checkCredentialAccess(userId, userRole, id, PermissionLevel.EDIT);
  const existing = await prisma.credential.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Credential not found');

  const scalar = {
    ...(data.friendlyName !== undefined && { friendlyName: data.friendlyName }),
    ...(data.credType !== undefined && { credType: data.credType }),
    ...(data.systemHost !== undefined && { systemHost: data.systemHost }),
    ...(data.username !== undefined && { username: data.username }),
    ...(data.policyRef !== undefined && { policyRef: data.policyRef }),
    ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt ? asDate(data.expiresAt) : null }),
  };

  if (data.secret !== undefined) {
    const encrypted = encrypt(data.secret);
    const nextVersion = (await prisma.credentialVersion.count({ where: { credentialId: id } })) + 1;
    await prisma.$transaction([
      prisma.credentialVersion.create({
        data: { credentialId: id, version: nextVersion, ...encrypted, createdById: userId },
      }),
      prisma.credential.update({
        where: { id },
        data: { ...scalar, ...encrypted, currentVersion: nextVersion },
      }),
    ]);
  } else {
    await prisma.credential.update({ where: { id }, data: scalar });
  }

  await createAuditLog({
    userId,
    action: 'EDIT',
    targetType: 'CREDENTIAL',
    targetId: id,
    metadata: { secretChanged: data.secret !== undefined },
    ...ctx,
  });
  return getCredential(id, userId, userRole);
}

/**
 * Decommission: the secret and every previous version are irrecoverably destroyed;
 * only the (non-secret) metadata row remains so the audit trail still resolves.
 */
export async function deleteCredential(id: string, userId: string, userRole: string, ctx: Ctx = {}) {
  await checkCredentialAccess(userId, userRole, id, PermissionLevel.MANAGE);
  const existing = await prisma.credential.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Credential not found');
  await prisma.$transaction([
    prisma.credentialVersion.deleteMany({ where: { credentialId: id } }),
    prisma.credential.update({
      where: { id },
      data: { deletedAt: new Date(), encryptedValue: '', iv: '', authTag: '' },
    }),
  ]);
  await createAuditLog({
    userId,
    action: 'DELETE',
    targetType: 'CREDENTIAL',
    targetId: id,
    metadata: { decommissioned: true },
    ...ctx,
  });
  emitEvent('credential.deleted', { id, name: existing.friendlyName });
}

interface RevealOptions {
  password?: string;
  viaApiKey?: boolean;
  apiKeyId?: string;
}

async function readSecret(
  id: string,
  action: 'REVEAL' | 'COPY',
  userId: string,
  userRole: string,
  opts: RevealOptions,
  ctx: Ctx,
) {
  await checkCredentialAccess(userId, userRole, id, PermissionLevel.COPY);
  await assertRevealReauth(userId, opts.password, !!opts.viaApiKey);
  const credential = await prisma.credential.findFirst({
    where: { id, deletedAt: null },
    select: { friendlyName: true, encryptedValue: true, iv: true, authTag: true, keyVersion: true },
  });
  if (!credential) throw new NotFoundError('Credential not found');
  // Audit BEFORE decrypt
  await createAuditLog({
    userId,
    action,
    targetType: 'CREDENTIAL',
    targetId: id,
    ...(opts.apiKeyId && { metadata: { apiKeyId: opts.apiKeyId } }),
    ...ctx,
  });
  if (action === 'REVEAL') {
    emitEvent('credential.revealed', { id, name: credential.friendlyName, userId }, `Credential "${credential.friendlyName}" was revealed.`);
  }
  return decrypt({
    encryptedValue: credential.encryptedValue,
    iv: credential.iv,
    authTag: credential.authTag,
    keyVersion: credential.keyVersion,
  });
}

export const revealCredential = (id: string, userId: string, userRole: string, opts: RevealOptions = {}, ctx: Ctx = {}) =>
  readSecret(id, 'REVEAL', userId, userRole, opts, ctx);

export const copyCredential = (id: string, userId: string, userRole: string, opts: RevealOptions = {}, ctx: Ctx = {}) =>
  readSecret(id, 'COPY', userId, userRole, opts, ctx);

// ─── Version history ──────────────────────────────────────────────────────────

export async function listVersions(id: string, userId: string, userRole: string) {
  await checkCredentialAccess(userId, userRole, id, PermissionLevel.EDIT);
  const credential = await prisma.credential.findFirst({ where: { id, deletedAt: null }, select: { currentVersion: true } });
  if (!credential) throw new NotFoundError('Credential not found');
  const versions = await prisma.credentialVersion.findMany({ where: { credentialId: id }, orderBy: { version: 'desc' } });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(versions.map((v) => v.createdById))] } },
    select: { id: true, name: true },
  });
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return versions.map((v) => ({
    id: v.id,
    version: v.version,
    createdAt: v.createdAt,
    changedBy: { id: v.createdById, name: byId.get(v.createdById) ?? null },
    isActive: v.version === credential.currentVersion,
  }));
}

export async function restoreVersion(id: string, versionId: string, userId: string, userRole: string, ctx: Ctx = {}) {
  await checkCredentialAccess(userId, userRole, id, PermissionLevel.EDIT);
  const version = await prisma.credentialVersion.findFirst({ where: { id: versionId, credentialId: id } });
  if (!version) throw new NotFoundError('Version not found');
  const credential = await prisma.credential.findFirst({ where: { id, deletedAt: null }, select: { currentVersion: true } });
  if (!credential) throw new NotFoundError('Credential not found');
  if (credential.currentVersion === version.version) return listVersions(id, userId, userRole);

  await prisma.credential.update({
    where: { id },
    data: {
      encryptedValue: version.encryptedValue,
      iv: version.iv,
      authTag: version.authTag,
      keyVersion: version.keyVersion,
      currentVersion: version.version,
    },
  });
  await createAuditLog({
    userId,
    action: 'RESTORE',
    targetType: 'CREDENTIAL',
    targetId: id,
    metadata: { restoredVersion: version.version },
    ...ctx,
  });
  return listVersions(id, userId, userRole);
}

export async function revealVersion(
  id: string,
  versionId: string,
  userId: string,
  userRole: string,
  opts: RevealOptions = {},
  ctx: Ctx = {},
) {
  await checkCredentialAccess(userId, userRole, id, PermissionLevel.EDIT);
  await checkCredentialAccess(userId, userRole, id, PermissionLevel.COPY);
  await assertRevealReauth(userId, opts.password, !!opts.viaApiKey);
  const version = await prisma.credentialVersion.findFirst({ where: { id: versionId, credentialId: id } });
  if (!version) throw new NotFoundError('Version not found');
  await createAuditLog({
    userId,
    action: 'REVEAL',
    targetType: 'CREDENTIAL',
    targetId: id,
    metadata: { version: version.version },
    ...ctx,
  });
  return decrypt(version);
}

// ─── Secret generator ─────────────────────────────────────────────────────────

const LETTERS_DIGITS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}<>?';

export function generateSecret(length = 20, symbols = true): string {
  const pool = symbols ? LETTERS_DIGITS + SYMBOLS : LETTERS_DIGITS;
  let out = '';
  for (let i = 0; i < length; i++) out += pool[randomInt(pool.length)];
  return out;
}
