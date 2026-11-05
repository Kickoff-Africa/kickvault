import { PermissionLevel } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { parseCsvTable } from '../../lib/csv.js';
import type { AuditParams } from '../../services/audit.service.js';
import { ValidationError } from '../../lib/errors.js';
import { derivePrefix } from '../categories/categories.service.js';

type Ctx = Pick<AuditParams, 'ipAddress' | 'userAgent'>;

const MAX_ROWS = 500;
const STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED', 'LOST'];

export interface AssetImportRow {
  line: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
  assetId: string;
  name: string;
  category: string;
  status: string;
  assignee: string | null;
  department: string | null;
  purchaseCost: number | null;
  vendor: string | null;
}

interface Resolved extends AssetImportRow {
  categoryName: string;
  assigneeId: string | null;
  data: { purchaseCost: number | null; vendor: string | null };
}

async function resolveRows(csv: string): Promise<Resolved[]> {
  const table = parseCsvTable(csv);
  const need = ['assetid', 'name'];
  const headerKeys = table.headers.map((h) => h.toLowerCase());
  for (const h of need) {
    if (!headerKeys.includes(h)) throw new ValidationError(`CSV is missing required column "${h === 'assetid' ? 'assetId' : h}"`);
  }
  if (table.records.length === 0) throw new ValidationError('CSV contains no data rows');
  if (table.records.length > MAX_ROWS) throw new ValidationError(`CSV exceeds the ${MAX_ROWS} row limit`);

  const [categories, departments, users, existing] = await Promise.all([
    prisma.category.findMany({ select: { name: true } }),
    prisma.department.findMany({ select: { name: true } }),
    prisma.user.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, email: true } }),
    prisma.asset.findMany({ select: { assetId: true } }),
  ]);
  const categoryNames = new Map(categories.map((c) => [c.name.toLowerCase(), c.name]));
  const departmentNames = new Map(departments.map((d) => [d.name.toLowerCase(), d.name]));
  const userByKey = new Map<string, string>();
  for (const u of users) {
    userByKey.set(u.name.toLowerCase(), u.id);
    userByKey.set(u.email.toLowerCase(), u.id);
  }
  const taken = new Set(existing.map((a) => a.assetId.toUpperCase()));

  return table.records.map(({ line, values }) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const assetId = (values['assetid'] ?? '').toUpperCase();
    const name = values['name'] ?? '';
    const categoryRaw = values['category'] ?? '';
    const statusRaw = (values['status'] ?? '').toUpperCase();
    const assigneeRaw = values['assignee'] ?? '';
    const departmentRaw = values['department'] ?? '';
    const costRaw = values['purchasecost'] ?? '';

    if (!/^[A-Z0-9][A-Z0-9-]{1,49}$/.test(assetId)) errors.push('assetId is missing or invalid');
    else if (taken.has(assetId)) errors.push(`assetId ${assetId} already exists or is duplicated in this file`);
    else taken.add(assetId);
    if (!name) errors.push('name is required');
    if (!categoryRaw) errors.push('category is required');
    if (statusRaw && !STATUSES.includes(statusRaw)) errors.push(`status must be one of ${STATUSES.join(', ')}`);

    let cost: number | null = null;
    if (costRaw) {
      cost = Number(costRaw.replace(/[,₦$\s]/g, ''));
      if (!Number.isFinite(cost) || cost < 0) {
        errors.push('purchaseCost must be a non-negative number');
        cost = null;
      }
    }

    let categoryName = categoryRaw;
    if (categoryRaw) {
      const known = categoryNames.get(categoryRaw.toLowerCase());
      if (known) categoryName = known;
      else warnings.push(`Category "${categoryRaw}" will be created`);
    }
    let departmentName: string | null = null;
    if (departmentRaw) {
      departmentName = departmentNames.get(departmentRaw.toLowerCase()) ?? departmentRaw;
      if (!departmentNames.has(departmentRaw.toLowerCase())) warnings.push(`Department "${departmentRaw}" will be created`);
    }
    let assigneeId: string | null = null;
    if (assigneeRaw) {
      assigneeId = userByKey.get(assigneeRaw.toLowerCase()) ?? null;
      if (!assigneeId) warnings.push(`Assignee "${assigneeRaw}" not found; asset will be unassigned`);
    }

    return {
      line,
      valid: errors.length === 0,
      errors,
      warnings,
      assetId,
      name,
      category: categoryName,
      categoryName,
      status: statusRaw || 'ACTIVE',
      assignee: assigneeId ? assigneeRaw : null,
      assigneeId,
      department: departmentName,
      purchaseCost: cost,
      vendor: values['vendor'] || null,
      data: { purchaseCost: cost, vendor: values['vendor'] || null },
    };
  });
}

const publicRow = ({ categoryName: _c, assigneeId: _a, data: _d, ...row }: Resolved): AssetImportRow => row;

export async function previewAssetImport(csv: string) {
  const rows = await resolveRows(csv);
  const valid = rows.filter((r) => r.valid).length;
  return { total: rows.length, valid, skipped: rows.length - valid, rows: rows.map(publicRow) };
}

export async function importAssets(csv: string, userId: string, ctx: Ctx = {}) {
  const rows = await resolveRows(csv);
  const importable = rows.filter((r) => r.valid);

  let imported = 0;
  for (const r of importable) {
    await prisma.$transaction(async (tx) => {
      const category =
        (await tx.category.findFirst({ where: { name: { equals: r.categoryName, mode: 'insensitive' } } })) ??
        (await tx.category.create({ data: { name: r.categoryName, prefix: derivePrefix(r.categoryName) } }));
      const department = r.department
        ? ((await tx.department.findFirst({ where: { name: { equals: r.department, mode: 'insensitive' } } })) ??
          (await tx.department.create({ data: { name: r.department } })))
        : null;

      const asset = await tx.asset.create({
        data: {
          assetId: r.assetId,
          name: r.name,
          categoryId: category.id,
          status: r.status as 'ACTIVE',
          assigneeId: r.assigneeId,
          departmentId: department?.id ?? null,
          purchaseCost: r.data.purchaseCost,
          vendor: r.data.vendor,
          createdById: userId,
        },
        select: { id: true },
      });
      await tx.assetAccess.create({ data: { userId, assetId: asset.id, permission: PermissionLevel.MANAGE } });
      if (r.assigneeId && r.assigneeId !== userId) {
        await tx.assetAccess.create({ data: { userId: r.assigneeId, assetId: asset.id, permission: PermissionLevel.VIEW } });
      }
      await tx.auditLog.create({
        data: { userId, action: 'CREATE', targetType: 'ASSET', targetId: asset.id, metadata: { via: 'csv-import' }, ipAddress: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null },
      });
    });
    imported++;
  }
  return { imported, skipped: rows.length - imported, rows: rows.map(publicRow) };
}
