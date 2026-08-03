import { basePrisma } from '../config/database.js';
import { env } from '../config/env.js';
import { hashPassword } from '../services/password.service.js';
import { logger } from './logger.js';

export async function seedSuperAdmin(): Promise<void> {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    return;
  }

  const existing = await basePrisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', deletedAt: null },
    select: { id: true },
  });

  if (existing) {
    return;
  }

  const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);

  await basePrisma.user.create({
    data: {
      email: env.SEED_ADMIN_EMAIL,
      name: env.SEED_ADMIN_NAME,
      passwordHash,
      role: 'SUPER_ADMIN',
      isActive: true,
      mustChangePassword: true,
    },
  });

  logger.info({ email: env.SEED_ADMIN_EMAIL }, 'Seeded initial SUPER_ADMIN');
}
