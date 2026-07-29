import {
  signAccessToken,
  generateRefreshToken,
  generateResetToken,
  hashToken,
} from '../../services/token.service.js';
import { verifyPassword, hashPassword } from '../../services/password.service.js';
import { sendPasswordResetEmail } from '../../services/email.service.js';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { UnauthorizedError, ForbiddenError } from '../../lib/errors.js';

export async function loginUser(
  email: string,
  password: string,
  userAgent?: string,
  ipAddress?: string,
) {
  const user = await prisma.user.findUnique({
    where: { email, isActive: true, deletedAt: null },
  });

  if (!user) {
    throw new UnauthorizedError('Invalid credentials');
  }

  // Check if account is locked
  if (user.lockedUntil !== null && user.lockedUntil > new Date()) {
    throw new ForbiddenError('Account is temporarily locked. Try again later.');
  }

  const valid = await verifyPassword(user.passwordHash, password);

  if (!valid) {
    // Atomically increment failedAttempts and get updated value
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });

    // Check the RETURNED post-increment value
    if (updated.failedAttempts >= 5) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          lockedUntil: new Date(
            Date.now() + env.ACCOUNT_LOCKOUT_DURATION_MIN * 60_000,
          ),
        },
      });
    }

    throw new UnauthorizedError('Invalid credentials');
  }

  // Success: reset failed attempts, update last login
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });

  const refreshToken = generateRefreshToken();
  const hashedRefreshToken = hashToken(refreshToken);

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken: hashedRefreshToken,
      expiresAt: new Date(
        Date.now() + env.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60_000,
      ),
      lastActiveAt: new Date(),
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
    },
  });

  const accessToken = await signAccessToken({
    userId: user.id,
    role: user.role,
    sessionId: session.id,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: env.ACCESS_TOKEN_EXPIRY_MIN * 60,
  };
}

export async function logoutUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export async function refreshSession(refreshToken: string) {
  const hashedToken = hashToken(refreshToken);

  const session = await prisma.session.findUnique({
    where: { refreshToken: hashedToken },
    include: { user: true },
  });

  if (!session) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Check absolute expiry
  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } });
    throw new UnauthorizedError('Session expired');
  }

  // Check inactivity timeout
  const inactivityCutoff = new Date(
    Date.now() - env.INACTIVE_SESSION_TIMEOUT_MIN * 60_000,
  );
  if (session.lastActiveAt <= inactivityCutoff) {
    await prisma.session.delete({ where: { id: session.id } });
    throw new UnauthorizedError('Session expired due to inactivity');
  }

  // Check user is still active
  if (!session.user.isActive) {
    await prisma.session.delete({ where: { id: session.id } });
    throw new UnauthorizedError('Account deactivated');
  }

  // Token rotation: delete old session, create new one
  await prisma.session.delete({ where: { id: session.id } });

  const newRefreshToken = generateRefreshToken();
  const hashedNewToken = hashToken(newRefreshToken);

  const newSession = await prisma.session.create({
    data: {
      userId: session.userId,
      refreshToken: hashedNewToken,
      expiresAt: new Date(
        Date.now() + env.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60_000,
      ),
      lastActiveAt: new Date(),
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
    },
  });

  const accessToken = await signAccessToken({
    userId: session.user.id,
    role: session.user.role,
    sessionId: newSession.id,
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: env.ACCESS_TOKEN_EXPIRY_MIN * 60,
  };
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email, isActive: true, deletedAt: null },
  });

  if (!user) {
    // Silent return — prevent email enumeration
    return;
  }

  const { plainToken, hashedToken } = generateResetToken();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetTokenHash: hashedToken,
      resetTokenExpiry: new Date(
        Date.now() + env.RESET_TOKEN_EXPIRY_MIN * 60_000,
      ),
    },
  });

  await sendPasswordResetEmail(email, plainToken);
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  const hashedToken = hashToken(token);

  const user = await prisma.user.findFirst({
    where: {
      resetTokenHash: hashedToken,
      resetTokenExpiry: { gt: new Date() },
      isActive: true,
      deletedAt: null,
    },
  });

  if (!user) {
    throw new UnauthorizedError('Invalid or expired reset token');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetTokenHash: null,
      resetTokenExpiry: null,
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  // Invalidate all sessions
  await prisma.session.deleteMany({ where: { userId: user.id } });
}
