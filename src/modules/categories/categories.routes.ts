import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { parse } from '../../lib/validate.js';
import { listCategories, createCategory } from './categories.service.js';

const router = Router();
const createSchema = z.object({ name: z.string().trim().min(1).max(100) });

router.get('/api/categories', authenticate, async (_req: Request, res: Response) => {
  res.json({ categories: await listCategories() });
});

// Used by the "Create New Category" option in the asset form.
router.post('/api/categories', authenticate, requireRole('MANAGER', 'MEMBER'), async (req: Request, res: Response) => {
  const { name } = parse(createSchema, req.body);
  res.status(201).json({ category: await createCategory(name) });
});

export { router as categoriesRoutes };
