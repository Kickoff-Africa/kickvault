import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let transporter: Transporter | null = null;

export function setTransporter(mock: Transporter): void {
  transporter = mock;
}

export function getTransporter(): Transporter {
  if (!transporter) {
    const pass = env.SMTP_API_KEY || env.SMTP_PASS;
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465, // TLS for port 465, STARTTLS for others
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass } : undefined,
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

export async function sendVerificationEmail(
  to: string,
  verifyToken: string,
): Promise<void> {
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${verifyToken}`;

  await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Kick Vault - Verify your email address',
    text: `Welcome to Kick Vault!\n\nPlease verify your email address by clicking the link below:\n${verifyUrl}\n\nThis link expires in ${env.EMAIL_VERIFY_EXPIRY_MIN} minutes.\n\nIf you did not create an account, ignore this email.`,
    html: `<p>Welcome to Kick Vault!</p><p>Please verify your email address:</p><p><a href="${verifyUrl}">Verify email address</a></p><p>This link expires in ${env.EMAIL_VERIFY_EXPIRY_MIN} minutes.</p><p>If you did not create an account, ignore this email.</p>`,
  });

  logger.info({ to }, 'Verification email sent');
}

export async function sendInviteEmail(
  to: string,
  tempPassword: string,
): Promise<void> {
  const loginUrl = `${env.FRONTEND_URL}/login`;

  await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Kick Vault - You have been invited',
    text: `You have been invited to Kick Vault.\n\nYour temporary password: ${tempPassword}\n\nLog in at: ${loginUrl}\n\nYou will be required to change your password after your first login.`,
    html: `<p>You have been invited to Kick Vault.</p><p>Your temporary password: <strong>${tempPassword}</strong></p><p><a href="${loginUrl}">Log in here</a></p><p>You will be required to change your password after your first login.</p>`,
  });

  logger.info({ to }, 'Invite email sent');
}
