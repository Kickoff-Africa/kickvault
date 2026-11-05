import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { parse } from '../../lib/validate.js';
import { ForbiddenError } from '../../lib/errors.js';
import { requestContext } from '../../services/audit.service.js';
import { createApiKey, listApiKeys, revokeApiKey } from './api-keys.service.js';

const router = Router();

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scope: z.enum(['READ_ONLY', 'READ_WRITE']).default('READ_ONLY'),
});

// API keys can never mint or revoke API keys.
const noApiKeys = (req: Request) => {
  if (req.apiKey) throw new ForbiddenError('API keys cannot manage API keys');
};

router.get('/api/api-keys', authenticate, async (req: Request, res: Response) => {
  noApiKeys(req);
  res.json({ apiKeys: await listApiKeys(req.user!.id) });
});

router.post('/api/api-keys', authenticate, async (req: Request, res: Response) => {
  noApiKeys(req);
  const { name, scope } = parse(createSchema, req.body);
  res.status(201).json(await createApiKey(req.user!.id, name, scope, requestContext(req)));
});

router.delete('/api/api-keys/:id', authenticate, async (req: Request, res: Response) => {
  noApiKeys(req);
  await revokeApiKey(req.user!.id, req.params.id as string, requestContext(req));
  res.status(204).end();
});

export { router as apiKeysRoutes };
