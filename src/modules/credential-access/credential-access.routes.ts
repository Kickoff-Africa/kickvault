import { Router } from 'express';
import * as credentialAccessController from './credential-access.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

router.post(
  '/api/credentials/:credentialId/access',
  authenticate,
  requireRole('MANAGER'),
  credentialAccessController.grant,
);

router.delete(
  '/api/credentials/:credentialId/access/:userId',
  authenticate,
  requireRole('MANAGER'),
  credentialAccessController.revoke,
);

router.get(
  '/api/credentials/:credentialId/access',
  authenticate,
  requireRole('MANAGER'),
  credentialAccessController.list,
);

export { router as credentialAccessRoutes };
