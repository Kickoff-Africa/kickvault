import { Router } from 'express';
import * as assetAccessController from './asset-access.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

router.post(
  '/api/assets/:assetId/access',
  authenticate,
  requireRole('MANAGER'),
  assetAccessController.grant,
);

router.delete(
  '/api/assets/:assetId/access/:userId',
  authenticate,
  requireRole('MANAGER'),
  assetAccessController.revoke,
);

router.get(
  '/api/assets/:assetId/access',
  authenticate,
  requireRole('MANAGER'),
  assetAccessController.list,
);

export { router as assetAccessRoutes };
