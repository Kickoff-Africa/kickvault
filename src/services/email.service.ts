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
