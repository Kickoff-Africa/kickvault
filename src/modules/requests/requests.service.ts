import { Prisma, type PermissionLevel, type RequestStatus, type RequestType } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { createAuditLog, type AuditParams } from '../../services/audit.service.js';
import { emitEvent } from '../../services/events.service.js';
import { effectiveAssetPermission, effectiveCredentialPermission, isPrivilegedRole } from '../../lib/access.js';
import { csvList } from '../../lib/validate.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { grantAssetAccess } from '../asset-access/asset-access.service.js';
import { grantCredentialAccess } from '../credential-access/credential-access.service.js';
import { findCategoryByName } from '../categories/categories.service.js';
import type { CreateRequestInput, ListRequestsQuery } from './requests.validation.js';

type Ctx = Pick<AuditParams, 'ipAddress' | 'userAgent'>;

const INCLUDE = {
  requester: { select: { id: true, name: true, email: true, avatarUrl: true } },
  asset: { select: { id: true, assetId: true, name: true } },
  credential: { select: { id: true, friendlyName: true } },
  category: { select: { id: true, name: true } },
} satisfies Prisma.AccessRequestInclude;

type Row = Prisma.AccessRequestGetPayload<{ include: typeof INCLUDE }>;

async function reviewerName(id: string | null) {
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true } });
  return u ?? { id, name: null };
}

async function serialize(r: Row) {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    requester: r.requester,
    target: r.asset
      ? { kind: 'ASSET', id: r.asset.id, label: `${r.asset.assetId} ${r.asset.name}` }
      : r.credential
        ? { kind: 'CREDENTIAL', id: r.credential.id, label: r.credential.friendlyName }
        : null,
    reason: r.reason,
    itemDescription: r.itemDescription,
    purchaseCost: r.purchaseCost === null ? null : Number(r.purchaseCost),
    category: r.category?.name ?? null,
    reviewedBy: await reviewerName(r.reviewedById),
    reviewedAt: r.reviewedAt,
    reviewNote: r.reviewNote,
    grantedPermission: r.grantedPermission,
    createdAt: r.createdAt,
  };
}

export async function createRequest(input: CreateRequestInput, userId: string, userRole: string) {
  let data: Prisma.AccessRequestUncheckedCreateInput;

  if (input.type === 'ASSET_ACCESS') {
    const asset = await prisma.asset.findFirst({ where: { id: input.assetId, deletedAt: null }, select: { id: true } });
    if (!asset) throw new NotFoundError('Asset not found');
    if (isPrivilegedRole(userRole) || (await effectiveAssetPermission(userId, asset.id))) {
      throw new ConflictError('You already have access to this asset');
    }
    data = { type: 'ASSET_ACCESS', requesterId: userId, assetId: asset.id, reason: input.reason };
  } else if (input.type === 'CREDENTIAL_ACCESS') {
    const cred = await prisma.credential.findFirst({ where: { id: input.credentialId, deletedAt: null }, select: { id: true } });
    if (!cred) throw new NotFoundError('Credential not found');
    if (isPrivilegedRole(userRole) || (await effectiveCredentialPermission(userId, cred.id))) {
      throw new ConflictError('You already have access to this credential');
    }
    data = { type: 'CREDENTIAL_ACCESS', requesterId: userId, credentialId: cred.id, reason: input.reason };
  } else {
    const category = await findCategoryByName(input.category);
    if (!category) throw new ValidationError(`Category "${input.category}" does not exist`);
    data = {
      type: 'PURCHASE',
      requesterId: userId,
      itemDescription: input.itemDescription,
      purchaseCost: input.purchaseCost,
      categoryId: category.id,
      reason: input.justification,
    };
  }

  if (data.type !== 'PURCHASE') {
    const dup = await prisma.accessRequest.findFirst({
      where: { requesterId: userId, status: 'PENDING', assetId: data.assetId ?? undefined, credentialId: data.credentialId ?? undefined, type: data.type },
      select: { id: true },
    });
    if (dup) throw new ConflictError('You already have a pending request for this item');
  }

  const created = await prisma.accessRequest.create({ data, include: INCLUDE });
  return serialize(created);
}

function listWhere(userId: string, userRole: string, q?: Partial<ListRequestsQuery>): Prisma.AccessRequestWhereInput {
  const and: Prisma.AccessRequestWhereInput[] = [];
  if (!isPrivilegedRole(userRole)) and.push({ requesterId: userId });
  const statuses = csvList(q?.status);
  if (statuses) and.push({ status: { in: statuses.map((s) => s.toUpperCase()) as RequestStatus[] } });
  const types = csvList(q?.type);
  if (types) and.push({ type: { in: types.map((s) => s.toUpperCase()) as RequestType[] } });
  if (q?.search) {
    const contains = { contains: q.search, mode: 'insensitive' as const };
    and.push({
      OR: [
        { reason: contains },
        { itemDescription: contains },
        { requester: { is: { name: contains } } },
        { asset: { is: { name: contains } } },
        { credential: { is: { friendlyName: contains } } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export async function listRequests(userId: string, userRole: string, q: ListRequestsQuery) {
  const where = listWhere(userId, userRole, q);
  const [rows, total] = await Promise.all([
    prisma.accessRequest.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.accessRequest.count({ where }),
  ]);
  return { requests: await Promise.all(rows.map(serialize)), total, page: q.page, limit: q.limit };
}

/** Badge on the "Requests" sidebar item. */
export async function pendingCount(userId: string, userRole: string) {
  return prisma.accessRequest.count({ where: listWhere(userId, userRole, { status: 'PENDING' }) });
}

async function loadVisible(id: string, userId: string, userRole: string) {
  const row = await prisma.accessRequest.findUnique({ where: { id }, include: INCLUDE });
  if (!row || (!isPrivilegedRole(userRole) && row.requesterId !== userId)) throw new NotFoundError('Request not found');
  return row;
}

export async function getRequest(id: string, userId: string, userRole: string) {
  return serialize(await loadVisible(id, userId, userRole));
}

function assertPending(row: Row) {
  if (row.status !== 'PENDING') throw new ConflictError(`Request has already been ${row.status.toLowerCase()}`);
}

export async function approveRequest(
  id: string,
  permission: PermissionLevel,
  note: string | undefined,
  reviewerId: string,
  reviewerRole: string,
  ctx: Ctx = {},
) {
  const row = await loadVisible(id, reviewerId, reviewerRole);
  if (!isPrivilegedRole(reviewerRole)) throw new ForbiddenError();
  assertPending(row);
  if (row.requesterId === reviewerId) throw new ForbiddenError('You cannot approve your own request');

  let granted: PermissionLevel | null = null;
  if (row.type === 'ASSET_ACCESS' && row.assetId) {
    await grantAssetAccess(row.assetId, row.requesterId, permission);
    granted = permission;
  } else if (row.type === 'CREDENTIAL_ACCESS' && row.credentialId) {
    await grantCredentialAccess(row.credentialId, row.requesterId, permission);
    granted = permission;
  }

  const updated = await prisma.accessRequest.update({
    where: { id },
    data: { status: 'APPROVED', reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: note, grantedPermission: granted },
    include: INCLUDE,
  });
  await createAuditLog({
    userId: reviewerId,
    action: 'APPROVE_REQUEST',
    targetType: row.assetId ? 'ASSET' : row.credentialId ? 'CREDENTIAL' : 'REQUEST',
    targetId: row.assetId ?? row.credentialId ?? id,
    metadata: { requestId: id, requesterId: row.requesterId, type: row.type, ...(granted && { permission: granted }) },
    ...ctx,
  });
  emitEvent('request.approved', { id, type: row.type, requesterId: row.requesterId });
  return serialize(updated);
}

export async function denyRequest(id: string, note: string | undefined, reviewerId: string, reviewerRole: string, ctx: Ctx = {}) {
  const row = await loadVisible(id, reviewerId, reviewerRole);
  if (!isPrivilegedRole(reviewerRole)) throw new ForbiddenError();
  assertPending(row);

  const updated = await prisma.accessRequest.update({
    where: { id },
    data: { status: 'DENIED', reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: note },
    include: INCLUDE,
  });
  await createAuditLog({
    userId: reviewerId,
    action: 'DENY_REQUEST',
    targetType: row.assetId ? 'ASSET' : row.credentialId ? 'CREDENTIAL' : 'REQUEST',
    targetId: row.assetId ?? row.credentialId ?? id,
    metadata: { requestId: id, requesterId: row.requesterId, type: row.type },
    ...ctx,
  });
  emitEvent('request.denied', { id, type: row.type, requesterId: row.requesterId });
  return serialize(updated);
}

export async function cancelRequest(id: string, userId: string, userRole: string) {
  const row = await loadVisible(id, userId, userRole);
  if (row.requesterId !== userId) throw new ForbiddenError('Only the requester can cancel a request');
  assertPending(row);
  const updated = await prisma.accessRequest.update({ where: { id }, data: { status: 'CANCELLED' }, include: INCLUDE });
  return serialize(updated);
}
