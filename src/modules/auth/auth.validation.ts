import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
