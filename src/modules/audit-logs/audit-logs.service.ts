import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { csvEscape } from '../../lib/csv.js';
import { csvList } from '../../lib/validate.js';
import { AUDIT_ACTIONS, describeAction, normalizeAction, storedActionValues } from '../../lib/audit-actions.js';
import { NotFoundError } from '../../lib/errors.js';
import { renderTablePdf } from '../assets/assets.documents.js';
import type { AuditFacetsQuery, ExportAuditLogsQuery, ListAuditLogsQuery } from './audit-logs.validation.js';

type Filters = Partial<Pick<ListAuditLogsQuery, 'action' | 'entityType' | 'userId' | 'search' | 'startDate' | 'endDate'>>;

function buildWhereClause(params: Filters): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];

  const actions = csvList(params.action);
  if (actions) and.push({ action: { in: storedActionValues(actions.map((a) => a.toUpperCase())) } });

  const entityTypes = csvList(params.entityType);
  if (entityTypes) and.push({ targetType: { in: entityTypes.map((t) => t.toUpperCase()) } });

  if (params.userId) and.push({ userId: params.userId });

  if (params.search) {
    const contains = { contains: params.search, mode: 'insensitive' as const };
    and.push({
      OR: [
        { action: contains },
        { targetType: contains },
        { targetId: contains },
        { userId: contains },
        { user: { is: { OR: [{ name: contains }, { email: contains }] } } },
      ],
    });
  }

  if (params.startDate || params.endDate) {
    and.push({
      createdAt: {
        ...(params.startDate && { gte: new Date(params.startDate) }),
        ...(params.endDate && { lte: new Date(params.endDate) }),
      },
    });
  }
  return and.length ? { AND: and } : {};
}

const AUDIT_LOG_USER_SELECT = { id: true, email: true, name: true } as const;

async function resolveTargetName(targetType: string, targetId: string | null): Promise<string | null> {
  if (!targetId) return null;
  switch (targetType) {
    case 'CREDENTIAL': {
      const c = await prisma.credential.findFirst({ where: { id: targetId }, select: { friendlyName: true } });
      return c?.friendlyName ?? null;
    }
    case 'ASSET': {
      const a = await prisma.asset.findFirst({ where: { id: targetId }, select: { name: true, assetId: true } });
      return a ? `${a.name} (${a.assetId})` : null;
    }
    case 'USER': {
      const u = await prisma.user.findFirst({ where: { id: targetId }, select: { name: true } });
      return u?.name ?? null;
    }
    case 'TEAM': {
      const t = await prisma.team.findFirst({ where: { id: targetId }, select: { name: true } });
      return t?.name ?? null;
    }
    default:
      return null;
  }
}

async function enrichLogs<T extends { targetType: string; targetId: string | null; action: string }>(logs: T[]) {
  const toResolve = new Map<string, { type: string; id: string }>();
  for (const log of logs) {
    if (log.targetId) toResolve.set(`${log.targetType}:${log.targetId}`, { type: log.targetType, id: log.targetId });
  }
  const resolved = new Map<string, string | null>();
  await Promise.all(
    [...toResolve.entries()].map(async ([key, { type, id }]) => {
      resolved.set(key, await resolveTargetName(type, id));
    }),
  );
  return logs.map((log) => ({
    ...log,
    action: normalizeAction(log.action),
    targetName: log.targetId ? (resolved.get(`${log.targetType}:${log.targetId}`) ?? null) : null,
  }));
}

export async function listAuditLogs(params: ListAuditLogsQuery) {
  const { cursor, limit, ...filters } = params;
  const logs = await prisma.auditLog.findMany({
    where: buildWhereClause(filters),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    include: { user: { select: AUDIT_LOG_USER_SELECT } },
  });

  const hasMore = logs.length > limit;
  const items = hasMore ? logs.slice(0, limit) : logs;
  const nextCursor = hasMore ? items[items.length - 1].id : undefined;
  return { items: await enrichLogs(items), nextCursor, hasMore };
}

export async function getAuditLog(id: string) {
  const log = await prisma.auditLog.findUnique({ where: { id }, include: { user: { select: AUDIT_LOG_USER_SELECT } } });
  if (!log) throw new NotFoundError('Audit log entry not found');
  const [enriched] = await enrichLogs([log]);
  return { ...enriched, description: describeAction(log.action), immutable: true };
}

/** Per-action counts for the action filter. Legacy UPDATE rows are folded into EDIT. */
export async function auditFacets(params: AuditFacetsQuery) {
  const grouped = await prisma.auditLog.groupBy({
    by: ['action'],
    where: buildWhereClause(params),
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  for (const g of grouped) counts.set(normalizeAction(g.action), (counts.get(normalizeAction(g.action)) ?? 0) + g._count._all);
  return { actions: AUDIT_ACTIONS.map((a) => ({ value: a, count: counts.get(a) ?? 0 })) };
}

const HEADERS = ['ID', 'Timestamp', 'User Email', 'User Name', 'Action', 'Target Type', 'Target ID', 'Target Name'];

export async function exportAuditLogs(params: ExportAuditLogsQuery) {
  const { format, ...filters } = params;
  const logs = await prisma.auditLog.findMany({
    where: buildWhereClause(filters),
    orderBy: { createdAt: 'desc' },
    take: 10_000,
    include: { user: { select: AUDIT_LOG_USER_SELECT } },
  });
  const enriched = await enrichLogs(logs);
  const rows = enriched.map((log) => [
    log.id,
    log.createdAt.toISOString(),
    log.user.email,
    log.user.name,
    log.action,
    log.targetType,
    log.targetId ?? '',
    log.targetName ?? '',
  ]);

  if (format === 'pdf') {
    return {
      contentType: 'application/pdf',
      filename: 'audit-logs.pdf',
      body: await renderTablePdf('Audit Logs', HEADERS, rows),
    };
  }
  const csv = [HEADERS.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n');
  return { contentType: 'text/csv', filename: 'audit-logs.csv', body: csv };
}

/** Kept for callers that used the old CSV-only export. */
export const exportAuditLogsCsv = async (params: Omit<ExportAuditLogsQuery, 'format'>) =>
  (await exportAuditLogs({ ...params, format: 'csv' })).body as string;
