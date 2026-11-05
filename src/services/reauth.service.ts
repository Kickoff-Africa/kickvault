import { prisma } from '../config/database.js';
import { verifyPassword } from './password.service.js';
import { AppError, UnauthorizedError } from '../lib/errors.js';

/**
 * If the user enabled "Require re-authentication for reveals", the caller must send their
 * password with the reveal/copy request. API keys are exempt: the key itself is the credential.
 */
export async function assertRevealReauth(userId: string, password: string | undefined, viaApiKey: boolean): Promise<void> {
  if (viaApiKey) return;
  const prefs = await prisma.userPreference.findUnique({
    where: { userId },
    select: { requireReauthForReveals: true },
  });
  if (!prefs?.requireReauthForReveals) return;

  if (!password) {
    const err = new AppError('Password confirmation is required to reveal secrets', 401, true, 'REAUTH_REQUIRED');
    throw err;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    throw new UnauthorizedError('Password is incorrect');
  }
}
