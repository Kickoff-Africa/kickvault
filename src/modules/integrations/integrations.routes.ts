import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { encrypt } from '../../lib/crypto.js';
import { parse } from '../../lib/validate.js';
import { assertHttpsPublicUrl } from '../../lib/url-safety.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { createAuditLog, requestContext } from '../../services/audit.service.js';

const router = Router();
const providerSchema = z.enum(['slack', 'teams']);
const bodySchema = z.object({ webhookUrl: z.string().url().max(1000) });

const admin = [authenticate, requireRole()]; // SUPER_ADMIN only

router.get('/api/integrations', ...admin, async (_req: Request, res: Response) => {
  const rows = await prisma.integration.findMany({ select: { provider: true, connectedAt: true } });
  const status = (p: 'SLACK' | 'TEAMS') => {
    const row = rows.find((r) => r.provider === p);
    return { connected: !!row, connectedAt: row?.connectedAt ?? null };
  };
  res.json({ slack: status('SLACK'), teams: status('TEAMS') });
});

// "Connect Slack" / "Connect Teams": register an incoming-webhook URL for alert and event notifications.
router.put('/api/integrations/:provider', ...admin, async (req: Request, res: Response) => {
  const provider = parse(providerSchema, req.params.provider);
  const { webhookUrl } = parse(bodySchema, req.body);
  const url = assertHttpsPublicUrl(webhookUrl);
  if (provider === 'slack' && !/(^|\.)slack\.com$/.test(url.hostname)) {
    throw new ValidationError('Slack webhook must be an https://hooks.slack.com URL');
  }
  const e = encrypt(webhookUrl);
  const enc = `${e.encryptedValue}.${e.iv}.${e.authTag}.${e.keyVersion}`;
  const key = provider === 'slack' ? 'SLACK' : 'TEAMS';
  const row = await prisma.integration.upsert({
    where: { provider: key },
    create: { provider: key, webhookUrlEnc: enc, connectedById: req.user!.id },
    update: { webhookUrlEnc: enc, connectedById: req.user!.id, connectedAt: new Date() },
    select: { provider: true, connectedAt: true },
  });
  await createAuditLog({ userId: req.user!.id, action: 'EDIT', targetType: 'INTEGRATION', targetId: key, metadata: { connected: true }, ...requestContext(req) });
  res.json({ integration: { provider: row.provider, connected: true, connectedAt: row.connectedAt } });
});

router.delete('/api/integrations/:provider', ...admin, async (req: Request, res: Response) => {
  const key = parse(providerSchema, req.params.provider) === 'slack' ? 'SLACK' : 'TEAMS';
  const res2 = await prisma.integration.deleteMany({ where: { provider: key } });
  if (res2.count === 0) throw new NotFoundError('Integration is not connected');
  await createAuditLog({ userId: req.user!.id, action: 'EDIT', targetType: 'INTEGRATION', targetId: key, metadata: { connected: false }, ...requestContext(req) });
  res.status(204).end();
});

export { router as integrationsRoutes };
