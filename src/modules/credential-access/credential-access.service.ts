import { PermissionLevel } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../lib/errors.js';

export async function grantCredentialAccess(
  credentialId: string,
  userId: string,
  permission: PermissionLevel,
) {
  const credential = await prisma.credential.findFirst({
    where: { id: credentialId, deletedAt: null },
  });
  if (!credential) throw new NotFoundError('Credential not found');

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
  });
  if (!user) throw new NotFoundError('User not found');

  const access = await prisma.credentialAccess.upsert({
    where: { userId_credentialId: { userId, credentialId } },
    create: { userId, credentialId, permission },
    update: { permission },
  });

  return access;
}

export async function revokeCredentialAccess(
  credentialId: string,
  userId: string,
) {
  const credential = await prisma.credential.findFirst({
    where: { id: credentialId, deletedAt: null },
  });
  if (!credential) throw new NotFoundError('Credential not found');

  try {
    await prisma.credentialAccess.delete({
      where: { userId_credentialId: { userId, credentialId } },
    });
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2025'
    ) {
      throw new NotFoundError('Access entry not found');
    }
    throw err;
  }
}

export async function listCredentialAccess(credentialId: string) {
  const credential = await prisma.credential.findFirst({
    where: { id: credentialId, deletedAt: null },
  });
  if (!credential) throw new NotFoundError('Credential not found');

  const access = await prisma.credentialAccess.findMany({
    where: { credentialId },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  return access;
}
