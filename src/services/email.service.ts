import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import {
  inviteEmailHtml,
  verifyEmailHtml,
  passwordResetEmailHtml,
} from '../lib/email-templates.js';

// Configurable — set USESEND_API_URL env var to your self-hosted instance

// Test helper — replace global fetch with a mock in tests
let _fetch: typeof fetch = fetch;
export function setFetch(mockFetch: typeof fetch): void {
  _fetch = mockFetch;
}
// Legacy no-op kept for backward compatibility with tests that imported setTransporter
export function setTransporter(_mock: unknown): void { _fetch = fetch; }

async function sendEmail(payload: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const res = await _fetch(env.USESEND_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SMTP_API_KEY}`,
    },
    body: JSON.stringify({
      from: env.SMTP_FROM,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`usesend API error ${res.status}: ${body}`);
  }

  const data = await res.json() as { emailId?: string };
  logger.info({ to: payload.to, emailId: data.emailId }, `Email sent: ${payload.subject}`);
}

export async function verifySmtp(): Promise<void> {
  if (!env.SMTP_API_KEY) {
    logger.warn('SMTP_API_KEY not set — emails will not be delivered');
    return;
  }
  logger.info('Email service: usesend API configured');
}

export async function sendPasswordResetEmail(
  to: string,
  resetToken: string,
): Promise<void> {
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  await sendEmail({
    to,
    subject: 'Reset your Kick Vault password',
    text: `You requested a password reset.\n\nClick here to reset your password: ${resetUrl}\n\nThis link expires in ${env.RESET_TOKEN_EXPIRY_MIN} minutes.\n\nIf you did not request this, ignore this email.`,
    html: passwordResetEmailHtml(resetUrl, env.RESET_TOKEN_EXPIRY_MIN),
  });
}

export async function sendVerificationEmail(
  to: string,
  verifyToken: string,
): Promise<void> {
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${verifyToken}`;
  await sendEmail({
    to,
    subject: 'Verify your Kick Vault email address',
    text: `Welcome to Kick Vault!\n\nVerify your email address: ${verifyUrl}\n\nThis link expires in ${env.EMAIL_VERIFY_EXPIRY_MIN} minutes.\n\nIf you did not create an account, ignore this email.`,
    html: verifyEmailHtml(verifyUrl, env.EMAIL_VERIFY_EXPIRY_MIN),
  });
}

export async function sendInviteEmail(
  to: string,
  inviteUrl: string,
): Promise<void> {
  await sendEmail({
    to,
    subject: "You've been invited to Kick Vault",
    text: `You have been invited to Kick Vault.\n\nSet up your account by clicking the link below:\n${inviteUrl}\n\nThis link expires in ${env.INVITE_TOKEN_EXPIRY_DAYS} day${env.INVITE_TOKEN_EXPIRY_DAYS === 1 ? '' : 's'}.\n\nIf you were not expecting this invitation, ignore this email.`,
    html: inviteEmailHtml(inviteUrl, env.INVITE_TOKEN_EXPIRY_DAYS),
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Sent to admins when a user is deactivated while holding assets that must be recovered. */
export async function sendAssetRecoveryNotification(
  to: string,
  deactivatedUserName: string,
  assets: { assetId: string; name: string }[],
): Promise<void> {
  const list = assets.map((a) => `${a.assetId} – ${a.name}`);
  await sendEmail({
    to,
    subject: `Asset recovery needed: ${deactivatedUserName} was deactivated`,
    text: `${deactivatedUserName}'s account was deactivated. The following assets are assigned to them and have been flagged for recovery:\n\n${list.join('\n')}`,
    html: `<p><strong>${esc(deactivatedUserName)}</strong>'s account was deactivated. The following assets are assigned to them and have been flagged for recovery:</p><ul>${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`,
  });
}

/** Sent when a sign-in happens from an IP the user has not used before. */
export async function sendNewLoginAlertEmail(
  to: string,
  device: string,
  ip: string | null,
): Promise<void> {
  await sendEmail({
    to,
    subject: 'New sign-in to your Kick Vault account',
    text: `We noticed a new sign-in from ${device}${ip ? ` (IP ${ip})` : ''}. If this was not you, revoke the session in Settings → Sessions and change your password.`,
    html: `<p>We noticed a new sign-in from <strong>${esc(device)}</strong>${ip ? ` (IP ${esc(ip)})` : ''}.</p><p>If this was not you, revoke the session in Settings → Sessions and change your password.</p>`,
  });
}

export async function sendAlertTriggeredEmail(
  to: string,
  ruleName: string,
  userLabel: string,
  action: string,
  count: number,
  windowMinutes: number,
): Promise<void> {
  const line = `${userLabel} performed ${action} ${count} time(s) within ${windowMinutes} minutes (rule: ${ruleName}).`;
  await sendEmail({
    to,
    subject: `Kick Vault alert: ${ruleName}`,
    text: line,
    html: `<p><strong>Alert rule triggered:</strong> ${esc(ruleName)}</p><p>${esc(line)}</p>`,
  });
}
