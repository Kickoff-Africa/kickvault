import { Router, type Request, type Response } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { parse } from '../../lib/validate.js';
import { requestContext } from '../../services/audit.service.js';
import * as svc from './requests.service.js';
import { createRequestSchema, listRequestsQuerySchema, approveRequestSchema, denyRequestSchema } from './requests.validation.js';

const router = Router();
const who = (req: Request) => ({ id: req.user!.id, role: req.user!.role as string });
const id = (req: Request) => req.params.id as string;

router.post('/api/requests', authenticate, async (req: Request, res: Response) => {
  const u = who(req);
  res.status(201).json({ request: await svc.createRequest(parse(createRequestSchema, req.body), u.id, u.role) });
});

// Managers see everyone's requests; everyone else sees only their own.
router.get('/api/requests', authenticate, async (req: Request, res: Response) => {
  const u = who(req);
  res.json(await svc.listRequests(u.id, u.role, parse(listRequestsQuerySchema, req.query)));
});

router.get('/api/requests/pending-count', authenticate, async (req: Request, res: Response) => {
  const u = who(req);
  res.json({ pending: await svc.pendingCount(u.id, u.role) });
});

router.get('/api/requests/:id', authenticate, async (req: Request, res: Response) => {
  const u = who(req);
  res.json({ request: await svc.getRequest(id(req), u.id, u.role) });
});

router.post('/api/requests/:id/approve', authenticate, async (req: Request, res: Response) => {
  const u = who(req);
  const b = parse(approveRequestSchema, req.body ?? {});
  res.json({ request: await svc.approveRequest(id(req), b.permission, b.note, u.id, u.role, requestContext(req)) });
});

router.post('/api/requests/:id/deny', authenticate, async (req: Request, res: Response) => {
  const u = who(req);
  const b = parse(denyRequestSchema, req.body ?? {});
  res.json({ request: await svc.denyRequest(id(req), b.note, u.id, u.role, requestContext(req)) });
});

router.post('/api/requests/:id/cancel', authenticate, async (req: Request, res: Response) => {
  const u = who(req);
  res.json({ request: await svc.cancelRequest(id(req), u.id, u.role) });
});

export { router as requestsRoutes };
