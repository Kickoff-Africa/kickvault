import { PermissionLevel } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ForbiddenError } from '../lib/errors.js';

const PERMISSION_HIERARCHY: Record<PermissionLevel, number> = {
  VIEW: 1,
  EDIT: 2,
  MANAGE: 3,
};

export async function checkCredentialAccess(
  userId: string,
  userRole: string,
  credentialId: string,
  requiredPermission: PermissionLevel,
): Promise<void> {
  if (userRole === 'SUPER_ADMIN' || userRole === 'MANAGER') return;

  const access = await prisma.credentialAccess.findUnique({
    where: { userId_credentialId: { userId, credentialId } },
  });

  if (!access) throw new ForbiddenError();

  if (PERMISSION_HIERARCHY[access.permission] < PERMISSION_HIERARCHY[requiredPermission]) {
    throw new ForbiddenError();
  }
}

export async function checkAssetAccess(
  userId: string,
  userRole: string,
  assetId: string,
  requiredPermission: PermissionLevel,
): Promise<void> {
  if (userRole === 'SUPER_ADMIN' || userRole === 'MANAGER') return;

  const access = await prisma.assetAccess.findUnique({
    where: { userId_assetId: { userId, assetId } },
  });

  if (!access) throw new ForbiddenError();

  if (PERMISSION_HIERARCHY[access.permission] < PERMISSION_HIERARCHY[requiredPermission]) {
    throw new ForbiddenError();
  }
}
