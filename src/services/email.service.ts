import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const USESEND_API_URL = 'https://app.usesend.com/api/v1/emails';

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
  const res = await _fetch(USESEND_API_URL, {
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
    subject: 'Kick Vault - Password Reset',
    text: `You requested a password reset. Click here to reset your password: ${resetUrl}\n\nThis link expires in ${env.RESET_TOKEN_EXPIRY_MIN} minutes.\n\nIf you did not request this, ignore this email.`,
    html: `<p>You requested a password reset.</p><p><a href="${resetUrl}">Click here to reset your password</a></p><p>This link expires in ${env.RESET_TOKEN_EXPIRY_MIN} minutes.</p><p>If you did not request this, ignore this email.</p>`,
  });
}

export async function sendVerificationEmail(
  to: string,
  verifyToken: string,
): Promise<void> {
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${verifyToken}`;
  await sendEmail({
    to,
    subject: 'Kick Vault - Verify your email address',
    text: `Welcome to Kick Vault!\n\nPlease verify your email address by clicking the link below:\n${verifyUrl}\n\nThis link expires in ${env.EMAIL_VERIFY_EXPIRY_MIN} minutes.\n\nIf you did not create an account, ignore this email.`,
    html: `<p>Welcome to Kick Vault!</p><p>Please verify your email address:</p><p><a href="${verifyUrl}">Verify email address</a></p><p>This link expires in ${env.EMAIL_VERIFY_EXPIRY_MIN} minutes.</p><p>If you did not create an account, ignore this email.</p>`,
  });
}

export async function sendInviteEmail(
  to: string,
  tempPassword: string,
): Promise<void> {
  const loginUrl = `${env.FRONTEND_URL}/login`;
  await sendEmail({
    to,
    subject: 'Kick Vault - You have been invited',
    text: `You have been invited to Kick Vault.\n\nYour temporary password: ${tempPassword}\n\nLog in at: ${loginUrl}\n\nYou will be required to change your password after your first login.`,
    html: `<p>You have been invited to Kick Vault.</p><p>Your temporary password: <strong>${tempPassword}</strong></p><p><a href="${loginUrl}">Log in here</a></p><p>You will be required to change your password after your first login.</p>`,
  });
}
