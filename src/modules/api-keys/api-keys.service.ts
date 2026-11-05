import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../../config/database.js';
import { createAuditLog, type AuditParams } from '../../services/audit.service.js';
import { NotFoundError } from '../../lib/errors.js';

type Ctx = Pick<AuditParams, 'ipAddress' | 'userAgent'>;

export const API_KEY_PREFIX = 'kv_live_';
export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function randomToken(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += BASE62[bytes[i] % BASE62.length];
  return out;
}

const serialize = (k: { id: string; name: string; scope: string; keyPrefix: string; lastFour: string; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }) => ({
  id: k.id,
  name: k.name,
  scope: k.scope,
  maskedKey: `${k.keyPrefix}..........${k.lastFour}`,
  lastUsedAt: k.lastUsedAt,
  revokedAt: k.revokedAt,
  createdAt: k.createdAt,
});

/** The plaintext key is returned exactly once, here. Only its SHA-256 is stored. */
export async function createApiKey(userId: string, name: string, scope: 'READ_ONLY' | 'READ_WRITE', ctx: Ctx = {}) {
  const key = `${API_KEY_PREFIX}${randomToken(32)}`;
  const row = await prisma.apiKey.create({
    data: { userId, name, scope, keyHash: hashApiKey(key), keyPrefix: key.slice(0, 12), lastFour: key.slice(-4) },
  });
  await createAuditLog({ userId, action: 'CREATE', targetType: 'API_KEY', targetId: row.id, metadata: { scope }, ...ctx });
  return { apiKey: serialize(row), key };
}

export async function listApiKeys(userId: string) {
  const rows = await prisma.apiKey.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: 'desc' } });
  return rows.map(serialize);
}

export async function revokeApiKey(userId: string, id: string, ctx: Ctx = {}) {
  const res = await prisma.apiKey.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (res.count === 0) throw new NotFoundError('API key not found');
  await createAuditLog({ userId, action: 'DELETE', targetType: 'API_KEY', targetId: id, ...ctx });
}
