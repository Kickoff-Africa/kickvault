import {
  signAccessToken,
  generateRefreshToken,
  generateResetToken,
  hashToken,
} from '../../services/token.service.js';
import { verifyPassword, hashPassword } from '../../services/password.service.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../../services/email.service.js';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { UnauthorizedError, ForbiddenError, ConflictError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { parseDeviceName } from '../../lib/device.js';

export async function loginUser(
  email: string,
  password: string,
  userAgent?: string,
  ipAddress?: string,
) {
  const user = await prisma.user.findUnique({
    where: { email, deletedAt: null },
  });

  if (!user) {
    throw new UnauthorizedError('Invalid credentials');
  }

  if (!user.isActive) {
    if (user.inviteTokenHash) {
      // Invited user — hasn't accepted invite yet
      throw new UnauthorizedError('Your account is pending. Please check your email to accept the invitation.');
    }
    if (!user.emailVerifiedAt) {
      // Self-registered — hasn't verified email yet
      throw new UnauthorizedError('Please verify your email address before logging in.');
    }
    // Deactivated by admin
    throw new UnauthorizedError('Invalid credentials');
  }

  // Check if account is locked
  if (user.lockedUntil !== null && user.lockedUntil > new Date()) {
    const remainingMs = user.lockedUntil.getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60_000);
    throw new ForbiddenError(
      `Account locked due to too many failed attempts. Try again in ${remainingMin} minute${remainingMin === 1 ? '' : 's'}.`,
    );
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
  // If this is an invited user logging in for the first time, activate them
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      ...(user.inviteTokenHash && {
        isActive: true,
        inviteTokenHash: null,
        inviteTokenExpiry: null,
      }),
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
      deviceName: parseDeviceName(userAgent),
    },
  });

  const accessToken = await signAccessToken({
    userId: user.id,
    role: user.role,
    sessionId: session.id,
    mustChangePassword: user.mustChangePassword,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: env.ACCESS_TOKEN_EXPIRY_MIN * 60,
    mustChangePassword: user.mustChangePassword,
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
  // Use deleteMany (no-op if already deleted) to avoid P2025 on concurrent refreshes
  await prisma.session.deleteMany({ where: { id: session.id } });

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
      deviceName: session.deviceName,
    },
  });

  const accessToken = await signAccessToken({
    userId: session.user.id,
    role: session.user.role,
    sessionId: newSession.id,
    mustChangePassword: session.user.mustChangePassword,
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: env.ACCESS_TOKEN_EXPIRY_MIN * 60,
    mustChangePassword: session.user.mustChangePassword,
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

  sendPasswordResetEmail(email, plainToken).catch((err) => {
    logger.error({ err, email }, 'Failed to send password reset email');
  });
}

export async function registerUser(
  email: string,
  name: string,
  password: string,
) {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    throw new ConflictError('An account with this email already exists');
  }

  const passwordHash = await hashPassword(password);
  const { plainToken, hashedToken } = generateResetToken(); // reuse same util

  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role: 'MEMBER',
      isActive: false, // inactive until email verified
      emailVerifyTokenHash: hashedToken,
      emailVerifyExpiry: new Date(Date.now() + env.EMAIL_VERIFY_EXPIRY_MIN * 60_000),
    },
  });

  sendVerificationEmail(email, plainToken).catch((err) => {
    logger.error({ err, email }, 'Failed to send verification email');
  });

  return { message: 'Account created. Please check your email to verify your account.' };
}

export async function verifyEmail(token: string, userAgent?: string, ipAddress?: string) {
  const hashedToken = hashToken(token);

  const user = await prisma.user.findFirst({
    where: {
      emailVerifyTokenHash: hashedToken,
      emailVerifyExpiry: { gt: new Date() },
      deletedAt: null,
    },
  });

  if (!user) {
    throw new UnauthorizedError('Invalid or expired verification link.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isActive: true,
      emailVerifiedAt: new Date(),
      emailVerifyTokenHash: null,
      emailVerifyExpiry: null,
    },
  });

  // Log them in immediately after verification
  const refreshToken = generateRefreshToken();
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60_000),
      lastActiveAt: new Date(),
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      deviceName: parseDeviceName(userAgent),
    },
  });

  const accessToken = await signAccessToken({
    userId: user.id,
    role: user.role,
    sessionId: session.id,
    mustChangePassword: false,
  });

  return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_EXPIRY_MIN * 60, mustChangePassword: false };
}

export async function resendVerification(email: string) {
  const user = await prisma.user.findUnique({
    where: { email, deletedAt: null },
    select: { id: true, isActive: true, emailVerifiedAt: true },
  });

  // Silent return — don't reveal whether email exists or is already verified
  if (!user || user.isActive || user.emailVerifiedAt) return;

  const { plainToken, hashedToken } = generateResetToken();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifyTokenHash: hashedToken,
      emailVerifyExpiry: new Date(Date.now() + env.EMAIL_VERIFY_EXPIRY_MIN * 60_000),
    },
  });

  sendVerificationEmail(email, plainToken).catch((err) => {
    logger.error({ err, email }, 'Failed to resend verification email');
  });
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
