import { Router, type Request, type Response } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { parse } from '../../lib/validate.js';
import { requestContext } from '../../services/audit.service.js';
import * as svc from './teams.service.js';
import {
  createTeamSchema,
  updateTeamSchema,
  listTeamsQuerySchema,
  assignAssetSchema,
  assignCredentialSchema,
} from './teams.validation.js';

const router = Router();
const manager = [authenticate, requireRole('MANAGER')];
const id = (req: Request) => req.params.id as string;

router.get('/api/teams', ...manager, async (req: Request, res: Response) => {
  res.json({ teams: await svc.listTeams(parse(listTeamsQuerySchema, req.query).search) });
});
router.post('/api/teams', ...manager, async (req: Request, res: Response) => {
  res.status(201).json({ team: await svc.createTeam(parse(createTeamSchema, req.body), req.user!.id, requestContext(req)) });
});
router.get('/api/teams/:id', ...manager, async (req: Request, res: Response) => {
  res.json({ team: await svc.getTeam(id(req)) });
});
router.patch('/api/teams/:id', ...manager, async (req: Request, res: Response) => {
  res.json({ team: await svc.updateTeam(id(req), parse(updateTeamSchema, req.body), req.user!.id, requestContext(req)) });
});
router.delete('/api/teams/:id', ...manager, async (req: Request, res: Response) => {
  await svc.deleteTeam(id(req), req.user!.id, requestContext(req));
  res.status(204).end();
});

router.post('/api/teams/:id/assets', ...manager, async (req: Request, res: Response) => {
  const b = parse(assignAssetSchema, req.body);
  res.status(201).json({ team: await svc.assignAsset(id(req), b.assetId, b.permission, req.user!.id, requestContext(req)) });
});
router.delete('/api/teams/:id/assets/:assetId', ...manager, async (req: Request, res: Response) => {
  await svc.unassignAsset(id(req), req.params.assetId as string, req.user!.id, requestContext(req));
  res.status(204).end();
});
router.post('/api/teams/:id/credentials', ...manager, async (req: Request, res: Response) => {
  const b = parse(assignCredentialSchema, req.body);
  res.status(201).json({ team: await svc.assignCredential(id(req), b.credentialId, b.permission, req.user!.id, requestContext(req)) });
});
router.delete('/api/teams/:id/credentials/:credentialId', ...manager, async (req: Request, res: Response) => {
  await svc.unassignCredential(id(req), req.params.credentialId as string, req.user!.id, requestContext(req));
  res.status(204).end();
});

export { router as teamsRoutes };
