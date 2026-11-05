import { prisma } from '../../config/database.js';
import { createAuditLog, onAuditLog, type AuditParams } from '../../services/audit.service.js';
import { emitEvent } from '../../services/events.service.js';
import { sendAlertTriggeredEmail } from '../../services/email.service.js';
import { AUDIT_ACTIONS, normalizeAction, storedActionValues } from '../../lib/audit-actions.js';
import { logger } from '../../lib/logger.js';
import { NotFoundError } from '../../lib/errors.js';

type Ctx = Pick<AuditParams, 'ipAddress' | 'userAgent'>;

export interface RuleInput {
  name: string;
  actionType: (typeof AUDIT_ACTIONS)[number];
  threshold: number;
  windowMinutes: number;
  enabled?: boolean;
}

export async function listRules() {
  return prisma.alertRule.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createRule(input: RuleInput, userId: string, ctx: Ctx = {}) {
  const rule = await prisma.alertRule.create({
    data: { ...input, enabled: input.enabled ?? true, createdById: userId },
  });
  await createAuditLog({ userId, action: 'CREATE', targetType: 'ALERT_RULE', targetId: rule.id, ...ctx });
  return rule;
}

export async function updateRule(id: string, input: Partial<RuleInput>, userId: string, ctx: Ctx = {}) {
  const existing = await prisma.alertRule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError('Alert rule not found');
  const rule = await prisma.alertRule.update({ where: { id }, data: input });
  await createAuditLog({ userId, action: 'EDIT', targetType: 'ALERT_RULE', targetId: id, ...ctx });
  return rule;
}

export async function deleteRule(id: string, userId: string, ctx: Ctx = {}) {
  const existing = await prisma.alertRule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError('Alert rule not found');
  await prisma.alertRule.delete({ where: { id } });
  await createAuditLog({ userId, action: 'DELETE', targetType: 'ALERT_RULE', targetId: id, ...ctx });
}

export async function listAlertEvents(limit = 50) {
  const events = await prisma.alertEvent.findMany({
    orderBy: { triggeredAt: 'desc' },
    take: limit,
    include: { rule: { select: { id: true, name: true, actionType: true, threshold: true, windowMinutes: true } } },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: events.map((e) => e.userId).filter((x): x is string => !!x) } },
    select: { id: true, name: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return events.map((e) => ({ ...e, user: e.userId ? (byId.get(e.userId) ?? null) : null }));
}

/**
 * Evaluate every enabled rule for the action that was just logged. A rule fires when the same user has
 * performed the action `threshold` times within `windowMinutes`, at most once per window per user.
 */
export async function evaluateRules(entry: { action: string; userId: string }): Promise<void> {
  const action = normalizeAction(entry.action);
  const rules = await prisma.alertRule.findMany({ where: { enabled: true, actionType: action } });
  for (const rule of rules) {
    const since = new Date(Date.now() - rule.windowMinutes * 60_000);
    const count = await prisma.auditLog.count({
      where: { userId: entry.userId, action: { in: storedActionValues([action]) }, createdAt: { gte: since } },
    });
    if (count < rule.threshold) continue;

    const recent = await prisma.alertEvent.findFirst({
      where: { ruleId: rule.id, userId: entry.userId, triggeredAt: { gte: since } },
      select: { id: true },
    });
    if (recent) continue;

    await prisma.alertEvent.create({ data: { ruleId: rule.id, userId: entry.userId, count } });
    const user = await prisma.user.findUnique({ where: { id: entry.userId }, select: { name: true, email: true } });
    const who = user ? `${user.name} <${user.email}>` : entry.userId;
    logger.warn({ ruleId: rule.id, userId: entry.userId, count }, 'Alert rule triggered');

    emitEvent(
      'alert.triggered',
      { ruleId: rule.id, ruleName: rule.name, action, count, windowMinutes: rule.windowMinutes, userId: entry.userId },
      `Alert "${rule.name}": ${who} performed ${action} ${count}× in ${rule.windowMinutes} min.`,
    );

    const admins = await prisma.user.findMany({
      where: {
        role: 'SUPER_ADMIN',
        isActive: true,
        deletedAt: null,
        OR: [{ preferences: { is: null } }, { preferences: { is: { transactionAlerts: true } } }],
      },
      select: { email: true },
    });
    for (const a of admins) {
      sendAlertTriggeredEmail(a.email, rule.name, who, action, count, rule.windowMinutes).catch((err) =>
        logger.error({ err, to: a.email }, 'Failed to send alert email'),
      );
    }
  }
}

export function registerAlertEngine(): void {
  onAuditLog(async (entry) => {
    // Rule changes themselves must not re-trigger rules.
    if (entry.targetType === 'ALERT_RULE') return;
    await evaluateRules(entry);
  });
}
