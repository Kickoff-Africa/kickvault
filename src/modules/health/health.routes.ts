import { Router } from 'express';
import { prisma } from '../../config/database.js';

export const healthRoutes = Router();

healthRoutes.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get('/health/ready', async (_req, res) => {
  const timestamp = new Date().toISOString();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ready',
      database: 'connected',
      timestamp,
    });
  } catch {
    res.status(503).json({
      status: 'not_ready',
      database: 'disconnected',
      timestamp,
    });
  }
});
