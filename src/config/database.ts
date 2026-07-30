import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const basePrisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = basePrisma;
}

export const prisma = basePrisma.$extends({
  query: {
    auditLog: {
      async update() {
        throw new Error('AuditLog entries are immutable: update is forbidden');
      },
      async updateMany() {
        throw new Error('AuditLog entries are immutable: updateMany is forbidden');
      },
      async delete() {
        throw new Error('AuditLog entries are immutable: delete is forbidden');
      },
      async deleteMany() {
        throw new Error('AuditLog entries are immutable: deleteMany is forbidden');
      },
    },
  },
});
