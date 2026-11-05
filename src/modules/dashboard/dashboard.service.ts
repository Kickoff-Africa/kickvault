import { prisma } from '../../config/database.js';

export async function getDashboardStats(thresholdDays = 30) {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + thresholdDays);

  const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z');

  const [totalAssets, totalCredentials, expiringCredentials, recentActivity, assetsByStatus, pendingRequests, overdueCheckouts, pendingRecovery] = await Promise.all([
    prisma.asset.count({ where: { deletedAt: null } }),
    prisma.credential.count({ where: { deletedAt: null } }),
    prisma.credential.count({
      where: {
        deletedAt: null,
        expiresAt: { lte: cutoff, gte: now },
      },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.asset.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.accessRequest.count({ where: { status: 'PENDING' } }),
    prisma.assetCheckout.count({ where: { returnedAt: null, dueDate: { lt: today } } }),
    prisma.asset.count({ where: { deletedAt: null, recoveryRequestedAt: { not: null } } }),
  ]);

  return {
    totalAssets,
    totalCredentials,
    expiringCredentials,
    recentActivity: recentActivity.map((l) => ({ ...l, action: l.action === 'UPDATE' ? 'EDIT' : l.action })),
    assetsByStatus: assetsByStatus.map((r) => ({ status: r.status, count: r._count._all })),
    pendingRequests,
    overdueCheckouts,
    pendingRecovery,
  };
}
