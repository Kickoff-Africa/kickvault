import type { Request, Response } from 'express';
import { listSessions, revokeSession, revokeAllOtherSessions } from './sessions.service.js';

export async function list(req: Request, res: Response): Promise<void> {
  const sessions = await listSessions(req.user!.id, req.sessionId!);
  res.json({ sessions });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  await revokeSession(req.params.id as string, req.user!.id, req.sessionId!);
  res.status(204).end();
}

export async function revokeOthers(req: Request, res: Response): Promise<void> {
  await revokeAllOtherSessions(req.user!.id, req.sessionId!);
  res.json({ message: 'All other sessions have been revoked.' });
}
