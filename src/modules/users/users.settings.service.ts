import type { UserPreference } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../../lib/totp.js';
import { verifyPassword } from '../../services/password.service.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../../lib/errors.js';
import type { PreferencesInput } from './users.validation.js';

// ─── Preferences ──────────────────────────────────────────────────────────────

function serializePreferences(p: UserPreference, twoFactorEnabled: boolean) {
  return {
    notifications: {
      transactionAlerts: p.transactionAlerts,
      credentialRevealEvents: p.credentialRevealEvents,
      expiryWarnings: p.expiryWarnings,
      criticalEventsOnly: p.criticalEventsOnly,
      emailDigest: p.emailDigest,
      weeklyDigest: p.weeklyDigest,
      slackWebhookUrl: p.slackWebhookUrl,
    },
    appearance: {
      theme: p.theme,
      fontSize: p.fontSize,
      sidebarDefault: p.sidebarDefault,
      secretMask: p.secretMask,
      reduceMotion: p.reduceMotion,
    },
    security: {
      loginNotifications: p.loginNotifications,
      requireReauthForReveals: p.requireReauthForReveals,
      sessionTimeoutMinutes: p.sessionTimeoutMin,
      twoFactorEnabled,
    },
  };
}

export async function getPreferences(userId: string) {
  const [prefs, user] = await Promise.all([
    prisma.userPreference.upsert({ where: { userId }, create: { userId }, update: {} }),
    prisma.user.findUnique({ where: { id: userId }, select: { totpEnabled: true } }),
  ]);
  return serializePreferences(prefs, user?.totpEnabled ?? false);
}

export async function updatePreferences(userId: string, input: PreferencesInput) {
  const slack = input.notifications?.slackWebhookUrl;
  if (slack) {
    const host = new URL(slack).hostname;
    if (new URL(slack).protocol !== 'https:' || !/(^|\.)slack\.com$/.test(host)) {
      throw new ValidationError('Slack webhook must be an https://hooks.slack.com URL');
    }
  }
  const { sessionTimeoutMinutes, ...security } = input.security ?? {};
  const data = {
    ...input.notifications,
    ...input.appearance,
    ...security,
    ...(sessionTimeoutMinutes !== undefined && { sessionTimeoutMin: sessionTimeoutMinutes }),
  };
  const prefs = await prisma.userPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { totpEnabled: true } });
  return serializePreferences(prefs, user?.totpEnabled ?? false);
}

// ─── Login history ────────────────────────────────────────────────────────────

export async function listLoginHistory(userId: string, limit = 20) {
  const events = await prisma.loginEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, success: true, ipAddress: true, deviceName: true, suspicious: true, createdAt: true },
  });
  return events.map((e) => ({ ...e, status: e.suspicious ? 'THREAT' : 'OK' }));
}

// ─── Two-factor authentication (TOTP) ─────────────────────────────────────────

const packSecret = (secret: string) => {
  const e = encrypt(secret);
  return `${e.encryptedValue}.${e.iv}.${e.authTag}.${e.keyVersion}`;
};

export function unpackTotpSecret(packed: string): string {
  const [encryptedValue, iv, authTag, keyVersion] = packed.split('.');
  return decrypt({ encryptedValue, iv, authTag, keyVersion: Number(keyVersion) });
}

/** Step 1: generate a secret and return the otpauth URI for the authenticator app. 2FA stays off until verified. */
export async function beginTotpSetup(userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { email: true, totpEnabled: true } });
  if (!user) throw new NotFoundError('User not found');
  if (user.totpEnabled) throw new ConflictError('Two-factor authentication is already enabled');
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: packSecret(secret), totpEnabled: false } });
  return { secret, otpauthUrl: totpUri(secret, user.email) };
}

/** Step 2: confirm with a code from the app to switch 2FA on. */
export async function confirmTotpSetup(userId: string, code: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { totpSecret: true, totpEnabled: true } });
  if (!user) throw new NotFoundError('User not found');
  if (user.totpEnabled) throw new ConflictError('Two-factor authentication is already enabled');
  if (!user.totpSecret) throw new ConflictError('Start two-factor setup first');
  if (!verifyTotp(unpackTotpSecret(user.totpSecret), code)) throw new UnauthorizedError('Invalid verification code');
  await prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
  return { twoFactorEnabled: true };
}

export async function disableTotp(userId: string, password: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { passwordHash: true } });
  if (!user) throw new NotFoundError('User not found');
  if (!(await verifyPassword(user.passwordHash, password))) throw new UnauthorizedError('Password is incorrect');
  await prisma.user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecret: null } });
  return { twoFactorEnabled: false };
}

// ─── Delete own account ───────────────────────────────────────────────────────

/** "Delete Your Account": permanent, password-confirmed. */
export async function deleteOwnAccount(userId: string, password: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      role: true,
      passwordHash: true,
      _count: { select: { credentials: { where: { deletedAt: null } }, assets: { where: { deletedAt: null } } } },
    },
  });
  if (!user) throw new NotFoundError('User not found');
  if (!(await verifyPassword(user.passwordHash, password))) throw new UnauthorizedError('Password is incorrect');

  if (user.role === 'SUPER_ADMIN') {
    const others = await prisma.user.count({
      where: { role: 'SUPER_ADMIN', isActive: true, deletedAt: null, id: { not: userId } },
    });
    if (others === 0) throw new ForbiddenError('You are the last SUPER_ADMIN and cannot delete your account');
  }
  if (user._count.credentials > 0 || user._count.assets > 0) {
    throw new ConflictError(
      `You own ${user._count.credentials} credential(s) and ${user._count.assets} asset(s). Transfer or delete them before deleting your account.`,
    );
  }
  // Cascades sessions, API keys, preferences, team memberships, access rows and audit entries.
  await prisma.user.delete({ where: { id: userId } });
}
