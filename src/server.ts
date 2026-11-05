import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { logger } from './lib/logger.js';
import { seedSuperAdmin } from './lib/seed.js';
import { verifySmtp } from './services/email.service.js';
import { expireOverdueCheckouts } from './modules/assets/assets.lifecycle.service.js';

await seedSuperAdmin();
await verifySmtp();

const server = app.listen(env.PORT, () => {
  logger.info(`Kick Vault API started on port ${env.PORT}`);
});

// Close asset checkouts whose due date has passed and revoke the access they granted.
const CHECKOUT_SWEEP_MS = 15 * 60_000;
const sweep = () =>
  expireOverdueCheckouts()
    .then((n) => n > 0 && logger.info({ closed: n }, 'Closed overdue asset checkouts'))
    .catch((err) => logger.error({ err }, 'Overdue checkout sweep failed'));
void sweep();
const sweepTimer = setInterval(sweep, CHECKOUT_SWEEP_MS);
sweepTimer.unref();

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down...`);
  clearInterval(sweepTimer);
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
