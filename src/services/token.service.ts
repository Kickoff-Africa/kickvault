import { SignJWT, jwtVerify } from 'jose';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);

export interface AccessTokenPayload {
  sub: string;
  role: string;
  sessionId: string;
  iss: string;
  iat: number;
  exp: number;
}

export async function signAccessToken(payload: {
  userId: string;
  role: string;
  sessionId: string;
}): Promise<string> {
  return new SignJWT({ role: payload.role, sessionId: payload.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_EXPIRY_MIN}m`)
    .setIssuer('kickvault')
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: 'kickvault',
    algorithms: ['HS256'],
  });
  return payload as unknown as AccessTokenPayload;
}

/**
 * SHA-256 hash any opaque token string before storage or lookup.
 * Used for both refresh tokens and password reset tokens.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateResetToken(): { plainToken: string; hashedToken: string } {
  const plainToken = crypto.randomBytes(32).toString('base64url');
  const hashedToken = hashToken(plainToken);
  return { plainToken, hashedToken };
}

export function generateInviteToken(): { plainToken: string; hashedToken: string } {
  const plainToken = crypto.randomBytes(32).toString('base64url');
  const hashedToken = hashToken(plainToken);
  return { plainToken, hashedToken };
}

export function generateTempPassword(): string {
  return crypto.randomBytes(16).toString('base64url');
}
