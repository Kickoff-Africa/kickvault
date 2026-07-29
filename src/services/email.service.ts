import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let transporter: Transporter | null = null;

export function setTransporter(mock: Transporter): void {
  transporter = mock;
}

export function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

export async function sendPasswordResetEmail(
  to: string,
  resetToken: string,
): Promise<void> {
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Kick Vault - Password Reset',
    text: `You requested a password reset. Click here to reset your password: ${resetUrl}\n\nThis link expires in ${env.RESET_TOKEN_EXPIRY_MIN} minutes.\n\nIf you did not request this, ignore this email.`,
    html: `<p>You requested a password reset.</p><p><a href="${resetUrl}">Click here to reset your password</a></p><p>This link expires in ${env.RESET_TOKEN_EXPIRY_MIN} minutes.</p><p>If you did not request this, ignore this email.</p>`,
  });

  logger.info({ to }, 'Password reset email sent');
}
