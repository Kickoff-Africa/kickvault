import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as credentialsController from './credentials.controller.js';
import { authenticate } from '../../middleware/authenticate.js';

const router = Router();

const revealRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  // Reveal sits behind authenticate, so req.user.id is always set here.
  // Never fall back to IP — avoids express-rate-limit's IPv6 validation error.
  keyGenerator: (req) => (req as any).user!.id as string,
  skip: (req) => !(req as any).user?.id,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reveal requests, please try again later' },
});

router.post('/api/credentials', authenticate, credentialsController.create);
router.get('/api/credentials', authenticate, credentialsController.list);
router.get('/api/credentials/:id', authenticate, credentialsController.getOne);
router.patch('/api/credentials/:id', authenticate, credentialsController.update);
router.delete('/api/credentials/:id', authenticate, credentialsController.remove);
router.post('/api/credentials/:id/reveal', authenticate, revealRateLimit, credentialsController.reveal);

export { router as credentialsRoutes };
