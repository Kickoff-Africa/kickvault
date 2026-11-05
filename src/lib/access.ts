import { PermissionLevel, type Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

export const PERMISSION_RANK: Record<PermissionLevel, number> = {
  VIEW: 1,
  COPY: 2,
  EDIT: 3,
  MANAGE: 4,
};

export function hasPermission(actual: PermissionLevel, required: PermissionLevel): boolean {
  return PERMISSION_RANK[actual] >= PERMISSION_RANK[required];
}

export function maxPermission(levels: (PermissionLevel | null | undefined)[]): PermissionLevel | null {
  let best: PermissionLevel | null = null;
  for (const l of levels) {
    if (l && (!best || PERMISSION_RANK[l] > PERMISSION_RANK[best])) best = l;
  }
  return best;
}

export function isPrivilegedRole(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'MANAGER';
}

/** Highest permission a user holds on a credential, directly or through any team they belong to. */
export async function effectiveCredentialPermission(
  userId: string,
  credentialId: string,
): Promise<PermissionLevel | null> {
  const [direct, viaTeams] = await Promise.all([
    prisma.credentialAccess.findUnique({
      where: { userId_credentialId: { userId, credentialId } },
      select: { permission: true },
    }),
    prisma.teamCredential.findMany({
      where: { credentialId, team: { members: { some: { userId } } } },
      select: { permission: true },
    }),
  ]);
  return maxPermission([direct?.permission, ...viaTeams.map((t) => t.permission)]);
}

/** Highest permission a user holds on an asset, directly or through any team they belong to. */
export async function effectiveAssetPermission(
  userId: string,
  assetId: string,
): Promise<PermissionLevel | null> {
  const [direct, viaTeams] = await Promise.all([
    prisma.assetAccess.findUnique({
      where: { userId_assetId: { userId, assetId } },
      select: { permission: true },
    }),
    prisma.teamAsset.findMany({
      where: { assetId, team: { members: { some: { userId } } } },
      select: { permission: true },
    }),
  ]);
  return maxPermission([direct?.permission, ...viaTeams.map((t) => t.permission)]);
}

/** Prisma filter: credentials a non-privileged user may see. */
export function credentialVisibleTo(userId: string): Prisma.CredentialWhereInput {
  return {
    OR: [
      { credentialAccess: { some: { userId } } },
      { teamCredentials: { some: { team: { members: { some: { userId } } } } } },
    ],
  };
}

/** Prisma filter: assets a non-privileged user may see (including ones assigned to them). */
export function assetVisibleTo(userId: string): Prisma.AssetWhereInput {
  return {
    OR: [
      { assetAccess: { some: { userId } } },
      { teamAssets: { some: { team: { members: { some: { userId } } } } } },
      { assigneeId: userId },
    ],
  };
}
