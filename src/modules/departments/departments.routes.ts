import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { parse } from '../../lib/validate.js';
import { listDepartments, createDepartment } from './departments.service.js';

const router = Router();
const createSchema = z.object({ name: z.string().trim().min(1).max(100) });

router.get('/api/departments', authenticate, async (_req: Request, res: Response) => {
  res.json({ departments: await listDepartments() });
});

// Used by the "Create New Department" option in the asset form.
router.post('/api/departments', authenticate, requireRole('MANAGER', 'MEMBER'), async (req: Request, res: Response) => {
  const { name } = parse(createSchema, req.body);
  res.status(201).json({ department: await createDepartment(name) });
});

export { router as departmentsRoutes };
