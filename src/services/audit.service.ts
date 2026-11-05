import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../lib/logger.js';

export interface AuditParams {
  userId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
}

type AuditListener = (entry: { id: string; action: string; targetType: string; targetId: string | null; userId: string; createdAt: Date }) => void | Promise<void>;

const listeners: AuditListener[] = [];

/** Register a side-effect to run after every audit entry (alert rules, webhooks). Failures never break the request. */
export function onAuditLog(listener: AuditListener): void {
  listeners.push(listener);
}

export async function createAuditLog(params: AuditParams): Promise<void> {
  const entry = await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      metadata: params.metadata,
    },
    select: { id: true, action: true, targetType: true, targetId: true, userId: true, createdAt: true },
  });

  for (const listener of listeners) {
    Promise.resolve()
      .then(() => listener(entry))
      .catch((err) => logger.error({ err, action: entry.action }, 'Audit listener failed'));
  }
}

/** Pull the client context off a request so audit rows record where an action came from. */
export function requestContext(req: { ip?: string; headers: Record<string, unknown> }): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const ua = req.headers['user-agent'];
  return { ipAddress: req.ip ?? null, userAgent: typeof ua === 'string' ? ua : null };
}
