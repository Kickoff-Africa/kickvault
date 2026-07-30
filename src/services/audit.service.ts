import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

export async function createAuditLog(params: {
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.auditLog.create({ data: params });
}
