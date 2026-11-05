import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as c from './credentials.controller.js';
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

router.post('/api/credentials', authenticate, c.create);
router.get('/api/credentials', authenticate, c.list);

// Static paths MUST be registered before /:id.
router.get('/api/credentials/facets', authenticate, c.facets);
router.post('/api/credentials/generate-secret', authenticate, c.generate);
router.post('/api/credentials/import/preview', authenticate, c.importPreview);
router.post('/api/credentials/import', authenticate, c.importCsv);

router.get('/api/credentials/:id', authenticate, c.getOne);
router.patch('/api/credentials/:id', authenticate, c.update);
router.delete('/api/credentials/:id', authenticate, c.remove); // decommission
router.post('/api/credentials/:id/reveal', authenticate, revealRateLimit, c.reveal);
router.post('/api/credentials/:id/copy', authenticate, revealRateLimit, c.copy);

router.get('/api/credentials/:id/versions', authenticate, c.versions);
router.post('/api/credentials/:id/versions/:versionId/restore', authenticate, c.restore);
router.post('/api/credentials/:id/versions/:versionId/reveal', authenticate, revealRateLimit, c.revealVersion);

export { router as credentialsRoutes };
