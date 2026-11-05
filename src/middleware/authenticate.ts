import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/token.service.js';
import { prisma } from '../config/database.js';
import { AppError, UnauthorizedError, ForbiddenError } from '../lib/errors.js';
import { API_KEY_PREFIX, hashApiKey } from '../modules/api-keys/api-keys.service.js';

// Routes allowed when mustChangePassword is true
const ALLOWED_WHEN_MUST_CHANGE = new Set([
  'POST /api/users/me/password',
  'POST /api/auth/logout',
]);

// Track last update time per session to avoid DB writes on every request
const lastUpdateCache = new Map<string, number>();
const UPDATE_THRESHOLD_MS = 60_000; // 1 minute

// API keys are for machine integrations: they can only reach these resource areas.
const API_KEY_ALLOWED_PREFIXES = ['/api/assets', '/api/credentials', '/api/audit-logs', '/api/dashboard', '/api/categories', '/api/departments'];
// A READ_ONLY key may still fetch a secret (CI/CD secret injection), which is audited as a REVEAL.
const READ_ONLY_POST_ALLOWED = /^\/api\/credentials\/[^/]+\/reveal$/;

async function authenticateApiKey(req: Request, key: string): Promise<void> {
  const row = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(key) },
    include: { user: { select: { id: true, role: true, isActive: true, deletedAt: true } } },
  });
  if (!row || row.revokedAt || !row.user.isActive || row.user.deletedAt) {
    throw new UnauthorizedError('Invalid or revoked API key');
  }
  const path = req.baseUrl + req.path;
  if (!API_KEY_ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    throw new ForbiddenError('This endpoint is not available to API keys');
  }
  if (row.scope === 'READ_ONLY') {
    const readOnly = req.method === 'GET' || req.method === 'HEAD';
    if (!readOnly && !(req.method === 'POST' && READ_ONLY_POST_ALLOWED.test(path))) {
      throw new ForbiddenError('This API key is read-only');
    }
  }
  req.user = { id: row.user.id, role: row.user.role };
  req.apiKey = { id: row.id, scope: row.scope };

  const now = Date.now();
  if (now - (lastUpdateCache.get(row.id) ?? 0) > UPDATE_THRESHOLD_MS) {
    lastUpdateCache.set(row.id, now);
    prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
}

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

  if (token.startsWith(API_KEY_PREFIX)) {
    await authenticateApiKey(req, token);
    next();
    return;
  }

  try {
    const payload = await verifyAccessToken(token);

    req.user = { id: payload.sub, role: payload.role };
    req.sessionId = payload.sessionId;

    // Block all actions until password is changed (SUPER_ADMIN is exempt)
    if (payload.mustChangePassword && payload.role !== 'SUPER_ADMIN') {
      const routeKey = `${req.method} ${req.path}`;
      if (!ALLOWED_WHEN_MUST_CHANGE.has(routeKey)) {
        const err = new ForbiddenError('You must change your password before continuing.');
        err.code = 'MUST_CHANGE_PASSWORD';
        throw err;
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
    if (err instanceof AppError) throw err;
    throw new UnauthorizedError('Invalid or expired token');
  }
}
