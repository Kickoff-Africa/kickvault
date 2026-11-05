import { Router } from 'express';
import * as assetAccessController from './asset-access.controller.js';
import { authenticate } from '../../middleware/authenticate.js';

const router = Router();

// Authorization (MANAGE on the asset) is enforced in the controller.
router.post('/api/assets/:assetId/access', authenticate, assetAccessController.grant);
router.delete('/api/assets/:assetId/access/:userId', authenticate, assetAccessController.revoke);
router.get('/api/assets/:assetId/access', authenticate, assetAccessController.list);

export { router as assetAccessRoutes };
