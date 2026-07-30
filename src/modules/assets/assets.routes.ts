import { Router } from 'express';
import * as assetsController from './assets.controller.js';
import { authenticate } from '../../middleware/authenticate.js';

const router = Router();

router.post('/api/assets', authenticate, assetsController.create);
router.get('/api/assets', authenticate, assetsController.list);
router.get('/api/assets/:id', authenticate, assetsController.getOne);
router.patch('/api/assets/:id', authenticate, assetsController.update);
router.delete('/api/assets/:id', authenticate, assetsController.remove);

export { router as assetsRoutes };
