import { PermissionLevel } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { checkAssetAccess } from '../../middleware/requireResourceAccess.js';
import { grantAssetAccess } from '../asset-access/asset-access.service.js';
import { createAuditLog } from '../../services/audit.service.js';
import { NotFoundError, ValidationError, ConflictError } from '../../lib/errors.js';
import type { CreateAssetInput, UpdateAssetInput } from './assets.validation.js';

const SAFE_ASSET_SELECT = {
  id: true,
  assetId: true,
  name: true,
  category: true,
  status: true,
  location: true,
  notes: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

const VALID_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ['MAINTENANCE', 'RETIRED', 'LOST'],
  MAINTENANCE: ['ACTIVE'],
  LOST: ['ACTIVE', 'RETIRED'],
  RETIRED: [],
};

export function validateStatusTransition(
  current: string,
  next: string,
  userRole: string,
): void {
  // Same status is a no-op, always allowed
  if (current === next) return;

  // SUPER_ADMIN can force any transition OUT of RETIRED
  if (current === 'RETIRED' && userRole === 'SUPER_ADMIN') return;

  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw new ValidationError(`Cannot transition asset from ${current} to ${next}`);
  }
}

export async function createAsset(data: CreateAssetInput, createdById: string) {
  let asset;
  try {
    asset = await prisma.asset.create({
      data: {
        assetId: data.assetId,
        name: data.name,
        category: data.category,
        status: data.status,
        location: data.location,
        notes: data.notes,
        createdById,
      },
      select: SAFE_ASSET_SELECT,
    });
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      throw new ConflictError('Asset ID already exists');
    }
    throw err;
  }

  // Auto-grant MANAGE access to creator
  await grantAssetAccess(asset.id, createdById, PermissionLevel.MANAGE);

  await createAuditLog({
    userId: createdById,
    action: 'CREATE',
    targetType: 'ASSET',
    targetId: asset.id,
  });

  return asset;
}

export async function listAssets(userId: string, userRole: string) {
  const isPrivileged = userRole === 'SUPER_ADMIN' || userRole === 'MANAGER';
  const whereClause = isPrivileged
    ? { deletedAt: null }
    : { deletedAt: null, assetAccess: { some: { userId } } };
  return prisma.asset.findMany({
    where: whereClause,
    select: SAFE_ASSET_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getAsset(id: string, userId: string, userRole: string) {
  await checkAssetAccess(userId, userRole, id, PermissionLevel.VIEW);
  const asset = await prisma.asset.findFirst({
    where: { id, deletedAt: null },
    select: SAFE_ASSET_SELECT,
  });
  if (!asset) throw new NotFoundError('Asset not found');
  return asset;
}

export async function updateAsset(
  id: string,
  data: UpdateAssetInput,
  userId: string,
  userRole: string,
) {
  await checkAssetAccess(userId, userRole, id, PermissionLevel.EDIT);
  const existing = await prisma.asset.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Asset not found');

  if (data.status !== undefined) {
    validateStatusTransition(existing.status, data.status, userRole);
  }

  const updated = await prisma.asset.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.category !== undefined && { category: data.category }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.location !== undefined && { location: data.location }),
      ...(data.notes !== undefined && { notes: data.notes }),
    },
    select: SAFE_ASSET_SELECT,
  });

  await createAuditLog({
    userId,
    action: 'UPDATE',
    targetType: 'ASSET',
    targetId: id,
  });

  return updated;
}

export async function deleteAsset(id: string, userId: string, userRole: string) {
  await checkAssetAccess(userId, userRole, id, PermissionLevel.MANAGE);
  const existing = await prisma.asset.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Asset not found');
  await prisma.asset.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await createAuditLog({
    userId,
    action: 'DELETE',
    targetType: 'ASSET',
    targetId: id,
  });
}
