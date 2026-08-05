import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import type { ListAuditLogsQuery, ExportAuditLogsQuery } from './audit-logs.validation.js';

function buildWhereClause(params: {
  action?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (params.action) {
    where.action = params.action;
  }

  if (params.userId) {
    where.userId = params.userId;
  }

  if (params.startDate || params.endDate) {
    where.createdAt = {};
    if (params.startDate) {
      where.createdAt.gte = new Date(params.startDate);
    }
    if (params.endDate) {
      where.createdAt.lte = new Date(params.endDate);
    }
  }

  return where;
}

const AUDIT_LOG_USER_SELECT = {
  id: true,
  email: true,
  name: true,
} as const;

async function resolveTargetName(targetType: string, targetId: string | null): Promise<string | null> {
  if (!targetId) return null;
  if (targetType === 'CREDENTIAL') {
    const c = await prisma.credential.findFirst({ where: { id: targetId }, select: { friendlyName: true } });
    return c?.friendlyName ?? null;
  }
  if (targetType === 'ASSET') {
    const a = await prisma.asset.findFirst({ where: { id: targetId }, select: { name: true, assetId: true } });
    return a ? `${a.name} (${a.assetId})` : null;
  }
  return null;
}

async function enrichLogs<T extends { targetType: string; targetId: string | null }>(logs: T[]) {
  // Deduplicate lookups by type+id
  const toResolve = new Map<string, { type: string; id: string }>();
  for (const log of logs) {
    if (log.targetId) {
      const key = `${log.targetType}:${log.targetId}`;
      toResolve.set(key, { type: log.targetType, id: log.targetId });
    }
  }

  const resolved = new Map<string, string | null>();
  await Promise.all(
    [...toResolve.entries()].map(async ([key, { type, id }]) => {
      resolved.set(key, await resolveTargetName(type, id));
    }),
  );

  return logs.map((log) => ({
    ...log,
    targetName: log.targetId ? (resolved.get(`${log.targetType}:${log.targetId}`) ?? null) : null,
  }));
}

export async function listAuditLogs(params: ListAuditLogsQuery) {
  const { cursor, limit, ...filters } = params;
  const where = buildWhereClause(filters);

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    include: {
      user: { select: AUDIT_LOG_USER_SELECT },
    },
  });

  const hasMore = logs.length > limit;
  const items = hasMore ? logs.slice(0, limit) : logs;
  const nextCursor = hasMore ? items[items.length - 1].id : undefined;
  const enriched = await enrichLogs(items);

  return { items: enriched, nextCursor, hasMore };
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportAuditLogsCsv(params: ExportAuditLogsQuery) {
  const where = buildWhereClause(params);

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10_000,
    include: {
      user: { select: AUDIT_LOG_USER_SELECT },
    },
  });

  const enriched = await enrichLogs(logs);

  const header = 'ID,Timestamp,User Email,User Name,Action,Target Type,Target ID,Target Name';
  const rows = enriched.map((log) =>
    [
      escapeCsv(log.id),
      escapeCsv(log.createdAt.toISOString()),
      escapeCsv(log.user.email),
      escapeCsv(log.user.name),
      escapeCsv(log.action),
      escapeCsv(log.targetType),
      escapeCsv(log.targetId ?? ''),
      escapeCsv(log.targetName ?? ''),
    ].join(','),
  );

  return [header, ...rows].join('\n');
}
