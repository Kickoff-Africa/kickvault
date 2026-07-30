import { PermissionLevel } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { checkCredentialAccess } from '../../middleware/requireResourceAccess.js';
import { grantCredentialAccess } from '../credential-access/credential-access.service.js';
import { createAuditLog } from '../../services/audit.service.js';
import { NotFoundError } from '../../lib/errors.js';
import type { CreateCredentialInput, UpdateCredentialInput } from './credentials.validation.js';

const SAFE_CREDENTIAL_SELECT = {
  id: true,
  friendlyName: true,
  systemHost: true,
  username: true,
  expiresAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function createCredential(data: CreateCredentialInput, createdById: string) {
  const encrypted = encrypt(data.secret);
  const credential = await prisma.credential.create({
    data: {
      friendlyName: data.friendlyName,
      systemHost: data.systemHost,
      username: data.username,
      encryptedValue: encrypted.encryptedValue,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      createdById,
    },
    select: SAFE_CREDENTIAL_SELECT,
  });
  // Auto-grant MANAGE access to creator
  await grantCredentialAccess(credential.id, createdById, PermissionLevel.MANAGE);
  return credential;
}

export async function listCredentials(userId: string, userRole: string) {
  const isPrivileged = userRole === 'SUPER_ADMIN' || userRole === 'MANAGER';
  const whereClause = isPrivileged
    ? { deletedAt: null }
    : { deletedAt: null, credentialAccess: { some: { userId } } };
  return prisma.credential.findMany({
    where: whereClause,
    select: SAFE_CREDENTIAL_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getCredential(id: string, userId: string, userRole: string) {
  await checkCredentialAccess(userId, userRole, id, PermissionLevel.VIEW);
  const credential = await prisma.credential.findFirst({
    where: { id, deletedAt: null },
    select: SAFE_CREDENTIAL_SELECT,
  });
  if (!credential) throw new NotFoundError('Credential not found');
  return credential;
}

export async function updateCredential(id: string, data: UpdateCredentialInput, userId: string, userRole: string) {
  await checkCredentialAccess(userId, userRole, id, PermissionLevel.EDIT);
  const existing = await prisma.credential.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Credential not found');

  let encryptionFields = {};
  if (data.secret !== undefined) {
    const encrypted = encrypt(data.secret);
    encryptionFields = {
      encryptedValue: encrypted.encryptedValue,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
    };
  }

  return prisma.credential.update({
    where: { id },
    data: {
      ...(data.friendlyName !== undefined && { friendlyName: data.friendlyName }),
      ...(data.systemHost !== undefined && { systemHost: data.systemHost }),
      ...(data.username !== undefined && { username: data.username }),
      ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt ? new Date(data.expiresAt) : null }),
      ...encryptionFields,
    },
    select: SAFE_CREDENTIAL_SELECT,
  });
}

export async function deleteCredential(id: string, userId: string, userRole: string) {
  await checkCredentialAccess(userId, userRole, id, PermissionLevel.MANAGE);
  const existing = await prisma.credential.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Credential not found');
  await prisma.credential.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function revealCredential(id: string, userId: string, userRole: string) {
  await checkCredentialAccess(userId, userRole, id, PermissionLevel.VIEW);
  const credential = await prisma.credential.findFirst({
    where: { id, deletedAt: null },
    select: { encryptedValue: true, iv: true, authTag: true, keyVersion: true },
  });
  if (!credential) throw new NotFoundError('Credential not found');
  // Audit BEFORE decrypt
  await createAuditLog({
    userId,
    action: 'REVEAL',
    targetType: 'CREDENTIAL',
    targetId: id,
  });
  return decrypt({
    encryptedValue: credential.encryptedValue,
    iv: credential.iv,
    authTag: credential.authTag,
    keyVersion: credential.keyVersion,
  });
}
