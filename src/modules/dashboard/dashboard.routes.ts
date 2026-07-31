import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import * as dashboardController from './dashboard.controller.js';

const router = Router();

router.get('/api/dashboard/stats', authenticate, requireRole('MANAGER'), dashboardController.stats);

export { router as dashboardRoutes };
