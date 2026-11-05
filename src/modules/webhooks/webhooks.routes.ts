import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { parse } from '../../lib/validate.js';
import { assertHttpsPublicUrl } from '../../lib/url-safety.js';
import { NotFoundError } from '../../lib/errors.js';
import { createAuditLog, requestContext } from '../../services/audit.service.js';
import { WEBHOOK_EVENTS } from '../../services/events.service.js';

const router = Router();

const createSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Subscribe to at least one event'),
});
const updateSchema = z
  .object({
    url: z.string().url().max(500).optional(),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'At least one field must be provided' });

const serialize = (w: { id: string; url: string; events: string[]; active: boolean; lastDeliveryAt: Date | null; lastDeliveryCode: number | null; createdAt: Date }) => ({
  id: w.id,
  url: w.url,
  events: w.events,
  active: w.active,
  lastDeliveryAt: w.lastDeliveryAt,
  lastDeliveryCode: w.lastDeliveryCode,
  createdAt: w.createdAt,
});

const admin = [authenticate, requireRole()]; // SUPER_ADMIN only

router.get('/api/webhooks/events', ...admin, (_req: Request, res: Response) => {
  res.json({ events: WEBHOOK_EVENTS });
});

router.get('/api/webhooks', ...admin, async (_req: Request, res: Response) => {
  res.json({ webhooks: (await prisma.webhook.findMany({ orderBy: { createdAt: 'desc' } })).map(serialize) });
});

// The signing secret is returned once, on creation.
router.post('/api/webhooks', ...admin, async (req: Request, res: Response) => {
  const body = parse(createSchema, req.body);
  assertHttpsPublicUrl(body.url);
  const secret = `whsec_${randomBytes(24).toString('hex')}`;
  const hook = await prisma.webhook.create({
    data: { url: body.url, events: [...new Set(body.events)], secret, createdById: req.user!.id },
  });
  await createAuditLog({ userId: req.user!.id, action: 'CREATE', targetType: 'WEBHOOK', targetId: hook.id, ...requestContext(req) });
  res.status(201).json({ webhook: serialize(hook), secret });
});

router.patch('/api/webhooks/:id', ...admin, async (req: Request, res: Response) => {
  const body = parse(updateSchema, req.body);
  if (body.url) assertHttpsPublicUrl(body.url);
  const existing = await prisma.webhook.findUnique({ where: { id: req.params.id as string }, select: { id: true } });
  if (!existing) throw new NotFoundError('Webhook not found');
  const hook = await prisma.webhook.update({
    where: { id: existing.id },
    data: { ...body, ...(body.events && { events: [...new Set(body.events)] }) },
  });
  await createAuditLog({ userId: req.user!.id, action: 'EDIT', targetType: 'WEBHOOK', targetId: hook.id, ...requestContext(req) });
  res.json({ webhook: serialize(hook) });
});

router.delete('/api/webhooks/:id', ...admin, async (req: Request, res: Response) => {
  const res2 = await prisma.webhook.deleteMany({ where: { id: req.params.id as string } });
  if (res2.count === 0) throw new NotFoundError('Webhook not found');
  await createAuditLog({ userId: req.user!.id, action: 'DELETE', targetType: 'WEBHOOK', targetId: req.params.id as string, ...requestContext(req) });
  res.status(204).end();
});

export { router as webhooksRoutes };
