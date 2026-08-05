import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import * as sessionsController from './sessions.controller.js';

const router = Router();

router.get('/api/sessions', authenticate, sessionsController.list);
router.delete('/api/sessions/others', authenticate, sessionsController.revokeOthers);
router.delete('/api/sessions/:id', authenticate, sessionsController.revoke);

export { router as sessionsRoutes };
