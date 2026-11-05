import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { normalizeAction } from '../../lib/audit-actions.js';
import { computeFinancials } from '../assets/assets.financials.js';

const router = Router();

/**
 * Organisation-wide overview for the Reports screen: asset mix, financial position,
 * credential hygiene, request backlog and the last 30 days of audit activity.
 */
router.get('/api/reports/overview', authenticate, requireRole('MANAGER'), async (_req: Request, res: Response) => {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86_400_000);
  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  const liveAssets: Prisma.AssetWhereInput = { deletedAt: null };
  const liveCreds: Prisma.CredentialWhereInput = { deletedAt: null };
  const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z');

  const [
    totalAssets, byCategory, byStatus, byDepartment, byInsurance, costAgg, depreciable,
    warrantyExpiring, warrantyExpired, recoveryPending,
    totalCreds, byType, credsExpiring, credsExpired,
    requestsByStatus, activeCheckouts, overdueCheckouts,
    activity, topUsers,
  ] = await Promise.all([
    prisma.asset.count({ where: liveAssets }),
    prisma.asset.groupBy({ by: ['categoryId'], where: liveAssets, _count: { _all: true } }),
    prisma.asset.groupBy({ by: ['status'], where: liveAssets, _count: { _all: true } }),
    prisma.asset.groupBy({ by: ['departmentId'], where: liveAssets, _count: { _all: true } }),
    prisma.asset.groupBy({ by: ['insuranceStatus'], where: liveAssets, _count: { _all: true } }),
    prisma.asset.aggregate({ where: liveAssets, _sum: { purchaseCost: true } }),
    prisma.asset.findMany({
      where: { ...liveAssets, purchaseCost: { not: null }, purchaseDate: { not: null }, usefulLifeYears: { not: null } },
      select: { purchaseCost: true, purchaseDate: true, usefulLifeYears: true },
    }),
    prisma.asset.count({ where: { ...liveAssets, warrantyExpiry: { gte: now, lte: in30 } } }),
    prisma.asset.count({ where: { ...liveAssets, warrantyExpiry: { lt: now } } }),
    prisma.asset.count({ where: { ...liveAssets, recoveryRequestedAt: { not: null } } }),
    prisma.credential.count({ where: liveCreds }),
    prisma.credential.groupBy({ by: ['credType'], where: liveCreds, _count: { _all: true } }),
    prisma.credential.count({ where: { ...liveCreds, expiresAt: { gte: now, lte: in30 } } }),
    prisma.credential.count({ where: { ...liveCreds, expiresAt: { lt: now } } }),
    prisma.accessRequest.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.assetCheckout.count({ where: { returnedAt: null } }),
    prisma.assetCheckout.count({ where: { returnedAt: null, dueDate: { lt: today } } }),
    prisma.auditLog.groupBy({ by: ['action'], where: { createdAt: { gte: since30 } }, _count: { _all: true } }),
    prisma.auditLog.groupBy({ by: ['userId'], where: { createdAt: { gte: since30 } }, _count: { _all: true }, orderBy: { _count: { userId: 'desc' } }, take: 5 }),
  ]);

  const [categories, departments, users] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: topUsers.map((t) => t.userId) } }, select: { id: true, name: true } }),
  ]);

  const bookValue = depreciable.reduce(
    (sum, a) =>
      sum +
      (computeFinancials({ purchaseCost: Number(a.purchaseCost), purchaseDate: a.purchaseDate, usefulLifeYears: a.usefulLifeYears }, now).currentBookValue ?? 0),
    0,
  );

  const actionCounts = new Map<string, number>();
  for (const a of activity) actionCounts.set(normalizeAction(a.action), (actionCounts.get(normalizeAction(a.action)) ?? 0) + a._count._all);

  res.json({
    generatedAt: now,
    assets: {
      total: totalAssets,
      byCategory: byCategory.map((r) => ({ name: categories.find((c) => c.id === r.categoryId)?.name ?? 'Unknown', count: r._count._all })),
      byStatus: byStatus.map((r) => ({ value: r.status, count: r._count._all })),
      byDepartment: byDepartment.map((r) => ({ name: departments.find((d) => d.id === r.departmentId)?.name ?? 'Unassigned', count: r._count._all })),
      byInsurance: byInsurance.map((r) => ({ value: r.insuranceStatus ?? 'UNSPECIFIED', count: r._count._all })),
      totalPurchaseCost: Number(costAgg._sum.purchaseCost ?? 0),
      totalBookValue: Math.round(bookValue * 100) / 100,
      warrantyExpiringIn30Days: warrantyExpiring,
      warrantyExpired,
      pendingRecovery: recoveryPending,
      activeCheckouts,
      overdueCheckouts,
    },
    credentials: {
      total: totalCreds,
      byType: byType.map((r) => ({ value: r.credType, count: r._count._all })),
      expiringIn30Days: credsExpiring,
      expired: credsExpired,
    },
    requests: requestsByStatus.map((r) => ({ status: r.status, count: r._count._all })),
    activity: {
      last30Days: [...actionCounts.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
      topUsers: topUsers.map((t) => ({ userId: t.userId, name: users.find((u) => u.id === t.userId)?.name ?? null, count: t._count._all })),
    },
  });
});

export { router as reportsRoutes };
