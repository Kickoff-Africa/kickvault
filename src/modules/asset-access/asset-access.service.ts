import { PermissionLevel } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../lib/errors.js';

export async function grantAssetAccess(
  assetId: string,
  userId: string,
  permission: PermissionLevel,
) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
  });
  if (!asset) throw new NotFoundError('Asset not found');

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
  });
  if (!user) throw new NotFoundError('User not found');

  const access = await prisma.assetAccess.upsert({
    where: { userId_assetId: { userId, assetId } },
    create: { userId, assetId, permission },
    update: { permission },
  });

  return access;
}

export async function revokeAssetAccess(
  assetId: string,
  userId: string,
) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
  });
  if (!asset) throw new NotFoundError('Asset not found');

  try {
    await prisma.assetAccess.delete({
      where: { userId_assetId: { userId, assetId } },
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

export async function listAssetAccess(assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
  });
  if (!asset) throw new NotFoundError('Asset not found');

  const access = await prisma.assetAccess.findMany({
    where: { assetId },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  return access;
}

/** Sharing view for an asset: creator, direct grants and team grants. */
export async function getAssetSharing(assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
    select: { createdBy: { select: { id: true, name: true, email: true } } },
  });
  if (!asset) throw new NotFoundError('Asset not found');

  const [access, teams] = await Promise.all([
    prisma.assetAccess.findMany({
      where: { assetId },
      include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
      orderBy: { grantedAt: 'asc' },
    }),
    prisma.teamAsset.findMany({ where: { assetId }, include: { team: { select: { id: true, name: true } } } }),
  ]);
  return {
    owner: asset.createdBy,
    access: access.map((a) => ({ ...a, isOwner: a.userId === asset.createdBy.id })),
    teams: teams.map((t) => ({ team: t.team, permission: t.permission, grantedAt: t.grantedAt })),
  };
}
