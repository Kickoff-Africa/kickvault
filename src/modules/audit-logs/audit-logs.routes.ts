import { Router } from 'express';
import * as auditLogsController from './audit-logs.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

// Static paths MUST come before /:id to avoid 'export' / 'facets' being captured as the id.
// SUPER_ADMIN only for export (CSV or PDF via ?format=)
router.get('/api/audit-logs/export', authenticate, requireRole(), auditLogsController.exportLogs);

// MANAGER+ can list audit logs (requireRole('MANAGER') allows SUPER_ADMIN + MANAGER)
router.get('/api/audit-logs/facets', authenticate, requireRole('MANAGER'), auditLogsController.facets);
router.get('/api/audit-logs', authenticate, requireRole('MANAGER'), auditLogsController.list);
router.get('/api/audit-logs/:id', authenticate, requireRole('MANAGER'), auditLogsController.getOne);

export { router as auditLogsRoutes };
