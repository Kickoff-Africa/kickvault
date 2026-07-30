import { Router } from 'express';
import * as auditLogsController from './audit-logs.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

// IMPORTANT: /export route MUST come before any /:id route to avoid 'export' being captured as param
// SUPER_ADMIN only for CSV export
router.get('/api/audit-logs/export', authenticate, requireRole(), auditLogsController.exportCsv);

// MANAGER+ can list audit logs (requireRole('MANAGER') allows SUPER_ADMIN + MANAGER)
router.get('/api/audit-logs', authenticate, requireRole('MANAGER'), auditLogsController.list);

export { router as auditLogsRoutes };
