import type { PermissionLevel } from '@prisma/client';
import { ForbiddenError } from '../lib/errors.js';
import {
  effectiveAssetPermission,
  effectiveCredentialPermission,
  hasPermission,
  isPrivilegedRole,
} from '../lib/access.js';

export async function checkCredentialAccess(
  userId: string,
  userRole: string,
  credentialId: string,
  requiredPermission: PermissionLevel,
): Promise<void> {
  if (isPrivilegedRole(userRole)) return;
  const actual = await effectiveCredentialPermission(userId, credentialId);
  if (!actual || !hasPermission(actual, requiredPermission)) throw new ForbiddenError();
}

export async function checkAssetAccess(
  userId: string,
  userRole: string,
  assetId: string,
  requiredPermission: PermissionLevel,
): Promise<void> {
  if (isPrivilegedRole(userRole)) return;
  const actual = await effectiveAssetPermission(userId, assetId);
  if (!actual || !hasPermission(actual, requiredPermission)) throw new ForbiddenError();
}
