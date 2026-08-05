import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/token.service.js';
import { prisma } from '../config/database.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';

// Routes allowed when mustChangePassword is true
const ALLOWED_WHEN_MUST_CHANGE = new Set([
  'POST /api/users/me/password',
  'POST /api/auth/logout',
]);

// Track last update time per session to avoid DB writes on every request
const lastUpdateCache = new Map<string, number>();
const UPDATE_THRESHOLD_MS = 60_000; // 1 minute

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyAccessToken(token);

    req.user = { id: payload.sub, role: payload.role };
    req.sessionId = payload.sessionId;

    // Block all actions until password is changed
    if (payload.mustChangePassword) {
      const routeKey = `${req.method} ${req.path}`;
      if (!ALLOWED_WHEN_MUST_CHANGE.has(routeKey)) {
        throw new ForbiddenError('You must change your password before continuing.');
      }
    }

    // Fire-and-forget lastActiveAt update with 1-minute threshold
    const now = Date.now();
    const lastUpdate = lastUpdateCache.get(payload.sessionId) ?? 0;
    if (now - lastUpdate > UPDATE_THRESHOLD_MS) {
      lastUpdateCache.set(payload.sessionId, now);
      prisma.session
        .update({
          where: { id: payload.sessionId },
          data: { lastActiveAt: new Date() },
        })
        .catch(() => {
          // Session may have been deleted (logout) — ignore
          lastUpdateCache.delete(payload.sessionId);
        });
    }

    next();
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Invalid or expired token');
  }
}
