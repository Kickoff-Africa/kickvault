import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { parse } from '../../lib/validate.js';
import { AUDIT_ACTIONS } from '../../lib/audit-actions.js';
import { requestContext } from '../../services/audit.service.js';
import * as svc from './alert-rules.service.js';

const router = Router();

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  actionType: z.enum(AUDIT_ACTIONS),
  threshold: z.number().int().min(1).max(10_000),
  windowMinutes: z.number().int().min(1).max(1440),
  enabled: z.boolean().optional(),
});
const updateSchema = createSchema
  .partial()
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'At least one field must be provided' });

// Managers can view rules and recent alerts; only SUPER_ADMIN can change them.
router.get('/api/alert-rules', authenticate, requireRole('MANAGER'), async (_req: Request, res: Response) => {
  res.json({ rules: await svc.listRules() });
});
router.get('/api/alert-rules/events', authenticate, requireRole('MANAGER'), async (_req: Request, res: Response) => {
  res.json({ events: await svc.listAlertEvents() });
});
router.post('/api/alert-rules', authenticate, requireRole(), async (req: Request, res: Response) => {
  res.status(201).json({ rule: await svc.createRule(parse(createSchema, req.body), req.user!.id, requestContext(req)) });
});
router.patch('/api/alert-rules/:id', authenticate, requireRole(), async (req: Request, res: Response) => {
  res.json({ rule: await svc.updateRule(req.params.id as string, parse(updateSchema, req.body), req.user!.id, requestContext(req)) });
});
router.delete('/api/alert-rules/:id', authenticate, requireRole(), async (req: Request, res: Response) => {
  await svc.deleteRule(req.params.id as string, req.user!.id, requestContext(req));
  res.status(204).end();
});

export { router as alertRulesRoutes };
