import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** 6-digit authenticator code; required only for accounts with two-factor enabled. */
  totpCode: z.string().regex(/^\d{6}$/, 'Code must be 6 digits').optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12, 'Password must be at least 12 characters'),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const resendVerificationSchema = z.object({
  email: z.string().email(),
});

import { env } from '../../config/env.js';

export const registerSchema = z.object({
  email: z.string().email().refine(
    (e) => {
      if (!env.ALLOWED_EMAIL_DOMAIN) return true;
      return e.toLowerCase().endsWith(`@${env.ALLOWED_EMAIL_DOMAIN}`);
    },
    {
      message: env.ALLOWED_EMAIL_DOMAIN
        ? `Registration is restricted to @${env.ALLOWED_EMAIL_DOMAIN} email addresses`
        : 'Invalid email',
    },
  ),
  name: z.string().min(1).max(100),
  password: z.string().min(12, 'Password must be at least 12 characters'),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12, 'Password must be at least 12 characters'),
});

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
