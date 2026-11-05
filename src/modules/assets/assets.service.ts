import { PermissionLevel, Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { checkAssetAccess } from '../../middleware/requireResourceAccess.js';
import { grantAssetAccess } from '../asset-access/asset-access.service.js';
import { createAuditLog, type AuditParams } from '../../services/audit.service.js';
import { emitEvent } from '../../services/events.service.js';
import { assetVisibleTo, isPrivilegedRole } from '../../lib/access.js';
import { csvList } from '../../lib/validate.js';
import { NotFoundError, ValidationError, ConflictError } from '../../lib/errors.js';
import { requireCategoryByName } from '../categories/categories.service.js';
import { requireDepartmentByName } from '../departments/departments.service.js';
import { computeFinancials } from './assets.financials.js';
import type { CreateAssetInput, UpdateAssetInput, ListAssetsQuery } from './assets.validation.js';

type Ctx = Pick<AuditParams, 'ipAddress' | 'userAgent'>;

export const ASSET_INCLUDE = {
  category: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
} satisfies Prisma.AssetInclude;

export type AssetWithRelations = Prisma.AssetGetPayload<{ include: typeof ASSET_INCLUDE }>;

const toDateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toNumber = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

const WARRANTY_WARNING_DAYS = 90;

function warrantyState(expiry: Date | null): 'VALID' | 'EXPIRING' | 'EXPIRED' | null {
  if (!expiry) return null;
  const now = Date.now();
  if (expiry.getTime() < now) return 'EXPIRED';
  if (expiry.getTime() - now <= WARRANTY_WARNING_DAYS * 86_400_000) return 'EXPIRING';
  return 'VALID';
}

export function serializeAsset(a: AssetWithRelations) {
  return {
    id: a.id,
    assetId: a.assetId,
    name: a.name,
    category: a.category.name,
    categoryId: a.categoryId,
    status: a.status,
    location: a.location,
    notes: a.notes,
    assignee: a.assignee,
    department: a.department?.name ?? null,
    serialNumber: a.serialNumber,
    manufacturer: a.manufacturer,
    model: a.model,
    specification: a.specification,
    vendor: a.vendor,
    purchaseDate: toDateOnly(a.purchaseDate),
    purchaseCost: toNumber(a.purchaseCost),
    warrantyExpiry: toDateOnly(a.warrantyExpiry),
    warrantyState: warrantyState(a.warrantyExpiry),
    insuranceStatus: a.insuranceStatus,
    policyRef: a.policyRef,
    depreciationMethod: a.depreciationMethod,
    usefulLifeYears: a.usefulLifeYears,
    recoveryRequestedAt: a.recoveryRequestedAt,
    disposedAt: a.disposedAt,
    certificateRef: a.certificateRef,
    createdById: a.createdById,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ['MAINTENANCE', 'RETIRED', 'LOST'],
  MAINTENANCE: ['ACTIVE'],
  LOST: ['ACTIVE', 'RETIRED'],
  RETIRED: [],
  // DISPOSED is terminal and only reachable through the dispose endpoint.
  DISPOSED: [],
};

export function validateStatusTransition(current: string, next: string, userRole: string): void {
  if (current === next) return;
  if (current === 'DISPOSED') throw new ValidationError('Disposed assets can no longer change status');
  if (next === 'DISPOSED') throw new ValidationError('Use the dispose endpoint to retire and dispose an asset');
  // SUPER_ADMIN can force any transition OUT of RETIRED
  if (current === 'RETIRED' && userRole === 'SUPER_ADMIN') return;
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw new ValidationError(`Cannot transition asset from ${current} to ${next}`);
  }
}

function generateAssetId(prefix: string): string {
  const digits = Math.floor(10000 + Math.random() * 90000); // 10000–99999
  return `${prefix}-${digits}`;
}

const asDate = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);

async function assertAssignee(assigneeId: string) {
  const user = await prisma.user.findFirst({
    where: { id: assigneeId, deletedAt: null, isActive: true },
    select: { id: true },
  });
  if (!user) throw new NotFoundError('Assignee not found');
}

export async function createAsset(data: CreateAssetInput, createdById: string, ctx: Ctx = {}) {
  const category = await requireCategoryByName(data.category);
  const department = data.department ? await requireDepartmentByName(data.department) : null;
  if (data.assigneeId) await assertAssignee(data.assigneeId);

  const explicitId = data.assetId?.toUpperCase();
  if (explicitId && (await prisma.asset.findUnique({ where: { assetId: explicitId }, select: { id: true } }))) {
    throw new ConflictError(`Asset ID ${explicitId} is already in use`);
  }

  const MAX_ATTEMPTS = 5;
  let created: AssetWithRelations | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      created = await prisma.asset.create({
        data: {
          assetId: explicitId ?? generateAssetId(category.prefix),
          name: data.name,
          categoryId: category.id,
          status: data.status,
          location: data.location,
          notes: data.notes,
          assigneeId: data.assigneeId ?? null,
          departmentId: department?.id ?? null,
          serialNumber: data.serialNumber,
          manufacturer: data.manufacturer,
          model: data.model,
          specification: data.specification,
          vendor: data.vendor,
          purchaseDate: data.purchaseDate ? asDate(data.purchaseDate) : undefined,
          purchaseCost: data.purchaseCost,
          warrantyExpiry: data.warrantyExpiry ? asDate(data.warrantyExpiry) : undefined,
          insuranceStatus: data.insuranceStatus,
          policyRef: data.policyRef,
          usefulLifeYears: data.usefulLifeYears,
          createdById,
        },
        include: ASSET_INCLUDE,
      });
      break;
    } catch (err: unknown) {
      const isUnique = typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002';
      if (isUnique && !explicitId && attempt < MAX_ATTEMPTS) continue;
      if (isUnique) throw new ConflictError('Could not generate a unique Asset ID, please try again');
      throw err;
    }
  }
  if (!created) throw new ConflictError('Could not generate a unique Asset ID, please try again');

  // Creator manages the asset; an assignee can at least view it.
  await grantAssetAccess(created.id, createdById, PermissionLevel.MANAGE);
  if (data.assigneeId && data.assigneeId !== createdById) {
    await grantAssetAccess(created.id, data.assigneeId, PermissionLevel.VIEW);
  }

  await createAuditLog({ userId: createdById, action: 'CREATE', targetType: 'ASSET', targetId: created.id, ...ctx });
  emitEvent('asset.created', { id: created.id, assetId: created.assetId, name: created.name });
  return serializeAsset(created);
}

function buildListWhere(userId: string, userRole: string, query?: ListAssetsQuery): Prisma.AssetWhereInput {
  const and: Prisma.AssetWhereInput[] = [{ deletedAt: null }];
  if (!isPrivilegedRole(userRole)) and.push(assetVisibleTo(userId));

  if (query?.search) {
    const contains = { contains: query.search, mode: 'insensitive' as const };
    and.push({
      OR: [
        { name: contains },
        { assetId: contains },
        { serialNumber: contains },
        { assignee: { is: { name: contains } } },
        { department: { is: { name: contains } } },
      ],
    });
  }
  const categories = csvList(query?.category);
  if (categories) and.push({ category: { is: { OR: categories.map((name) => ({ name: { equals: name, mode: 'insensitive' as const } })) } } });
  const statuses = csvList(query?.status);
  if (statuses) {
    const valid = statuses.map((s) => s.toUpperCase());
    and.push({ status: { in: valid as never[] } });
  }
  const departments = csvList(query?.department);
  if (departments) and.push({ department: { is: { OR: departments.map((name) => ({ name: { equals: name, mode: 'insensitive' as const } })) } } });
  const assignees = csvList(query?.assignee);
  if (assignees) and.push({ assigneeId: { in: assignees } });
  const insurance = csvList(query?.insurance);
  if (insurance) and.push({ insuranceStatus: { in: insurance.map((s) => s.toUpperCase()) as never[] } });

  return { AND: and };
}

const ORDER_BY: Record<ListAssetsQuery['sort'], Prisma.AssetOrderByWithRelationInput> = {
  registered_desc: { createdAt: 'desc' },
  registered_asc: { createdAt: 'asc' },
  name_asc: { name: 'asc' },
  name_desc: { name: 'desc' },
  warranty_asc: { warrantyExpiry: { sort: 'asc', nulls: 'last' } },
  warranty_desc: { warrantyExpiry: { sort: 'desc', nulls: 'last' } },
};

export async function listAssets(userId: string, userRole: string, query?: ListAssetsQuery) {
  const where = buildListWhere(userId, userRole, query);
  const orderBy = ORDER_BY[query?.sort ?? 'registered_desc'];
  const limit = query?.limit;
  const page = query?.page ?? 1;

  const [rows, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      include: ASSET_INCLUDE,
      orderBy,
      ...(limit && { take: limit, skip: (page - 1) * limit }),
    }),
    prisma.asset.count({ where }),
  ]);
  return { assets: rows.map(serializeAsset), total, ...(limit && { page, limit }) };
}

/** Counts behind the filter dropdowns (category, status, department, assignee, insurance). */
export async function assetFacets(userId: string, userRole: string) {
  const base = buildListWhere(userId, userRole);
  const [byCategory, byStatus, byDepartment, byAssignee, byInsurance] = await Promise.all([
    prisma.asset.groupBy({ by: ['categoryId'], where: base, _count: { _all: true } }),
    prisma.asset.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.asset.groupBy({ by: ['departmentId'], where: base, _count: { _all: true } }),
    prisma.asset.groupBy({ by: ['assigneeId'], where: base, _count: { _all: true } }),
    prisma.asset.groupBy({ by: ['insuranceStatus'], where: base, _count: { _all: true } }),
  ]);

  const [categories, departments, users] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({
      where: { id: { in: byAssignee.map((a) => a.assigneeId).filter((x): x is string => !!x) } },
      select: { id: true, name: true },
    }),
  ]);
  const count = <T extends { _count: { _all: number } }>(rows: T[], pick: (r: T) => unknown, key: unknown) =>
    rows.find((r) => pick(r) === key)?._count._all ?? 0;

  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name, count: count(byCategory, (r) => r.categoryId, c.id) })),
    statuses: ['ACTIVE', 'MAINTENANCE', 'RETIRED', 'LOST', 'DISPOSED'].map((s) => ({ value: s, count: count(byStatus, (r) => r.status, s) })),
    departments: departments.map((d) => ({ id: d.id, name: d.name, count: count(byDepartment, (r) => r.departmentId, d.id) })),
    assignees: users.map((u) => ({ id: u.id, name: u.name, count: count(byAssignee, (r) => r.assigneeId, u.id) })),
    insuranceStatuses: ['INSURED', 'UNINSURED', 'UNDER_REVIEW'].map((s) => ({ value: s, count: count(byInsurance, (r) => r.insuranceStatus, s) })),
  };
}

export async function getAssetRecord(id: string) {
  const asset = await prisma.asset.findFirst({ where: { id, deletedAt: null }, include: ASSET_INCLUDE });
  if (!asset) throw new NotFoundError('Asset not found');
  return asset;
}

export async function getAsset(id: string, userId: string, userRole: string) {
  await checkAssetAccess(userId, userRole, id, PermissionLevel.VIEW);
  return serializeAsset(await getAssetRecord(id));
}

export async function getAssetFinancials(id: string, userId: string, userRole: string) {
  await checkAssetAccess(userId, userRole, id, PermissionLevel.VIEW);
  const asset = await getAssetRecord(id);
  return computeFinancials({
    purchaseCost: toNumber(asset.purchaseCost),
    purchaseDate: asset.purchaseDate,
    usefulLifeYears: asset.usefulLifeYears,
  });
}

export async function updateAsset(id: string, data: UpdateAssetInput, userId: string, userRole: string, ctx: Ctx = {}) {
  await checkAssetAccess(userId, userRole, id, PermissionLevel.EDIT);
  const existing = await prisma.asset.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Asset not found');
  if (existing.status === 'DISPOSED') throw new ConflictError('Disposed assets cannot be edited');

  if (data.status !== undefined) validateStatusTransition(existing.status, data.status, userRole);

  const category = data.category !== undefined ? await requireCategoryByName(data.category) : undefined;
  let departmentId: string | null | undefined;
  if (data.department !== undefined) {
    departmentId = data.department === null ? null : (await requireDepartmentByName(data.department)).id;
  }
  if (data.assigneeId) await assertAssignee(data.assigneeId);

  const dateOrNull = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : asDate(v));

  const updated = await prisma.asset.update({
    where: { id },
    data: {
      name: data.name,
      ...(category && { categoryId: category.id }),
      status: data.status,
      location: data.location,
      notes: data.notes,
      ...(data.assigneeId !== undefined && { assigneeId: data.assigneeId, recoveryRequestedAt: null }),
      ...(departmentId !== undefined && { departmentId }),
      serialNumber: data.serialNumber,
      manufacturer: data.manufacturer,
      model: data.model,
      specification: data.specification,
      vendor: data.vendor,
      purchaseDate: dateOrNull(data.purchaseDate),
      purchaseCost: data.purchaseCost,
      warrantyExpiry: dateOrNull(data.warrantyExpiry),
      insuranceStatus: data.insuranceStatus,
      policyRef: data.policyRef,
      usefulLifeYears: data.usefulLifeYears,
    },
    include: ASSET_INCLUDE,
  });

  if (data.assigneeId && data.assigneeId !== existing.assigneeId) {
    await grantAssetAccess(id, data.assigneeId, PermissionLevel.VIEW).catch(() => undefined);
  }

  await createAuditLog({ userId, action: 'EDIT', targetType: 'ASSET', targetId: id, ...ctx });
  if (data.status !== undefined && data.status !== existing.status) {
    emitEvent('asset.status_changed', { id, assetId: updated.assetId, from: existing.status, to: data.status });
  }
  return serializeAsset(updated);
}

export async function deleteAsset(id: string, userId: string, userRole: string, ctx: Ctx = {}) {
  await checkAssetAccess(userId, userRole, id, PermissionLevel.MANAGE);
  const existing = await prisma.asset.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Asset not found');
  await prisma.asset.update({ where: { id }, data: { deletedAt: new Date() } });
  await createAuditLog({ userId, action: 'DELETE', targetType: 'ASSET', targetId: id, ...ctx });
  emitEvent('asset.deleted', { id, assetId: existing.assetId });
}
