import { prisma } from '../../config/database.js';

export async function getDashboardStats(thresholdDays = 30) {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + thresholdDays);

  const [totalAssets, totalCredentials, expiringCredentials, recentActivity] = await Promise.all([
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
  ]);

  return { totalAssets, totalCredentials, expiringCredentials, recentActivity };
}
