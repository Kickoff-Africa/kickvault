import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  registerSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  acceptInviteSchema,
} from './auth.validation.js';
import {
  loginUser,
  logoutUser,
  refreshSession,
  requestPasswordReset,
  resetPassword as resetPasswordService,
  registerUser,
  verifyEmail,
  resendVerification,
  acceptInvite,
} from './auth.service.js';
import { ValidationError, ForbiddenError } from '../../lib/errors.js';
import { env } from '../../config/env.js';

function parseBody<T>(schema: { parse: (data: unknown) => T }, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ValidationError(err.issues[0].message);
    }
    throw err;
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = parseBody(loginSchema, req.body);
  const result = await loginUser(
    email,
    password,
    req.headers['user-agent'] as string | undefined,
    req.ip,
  );
  res.status(200).json(result);
}

export async function logout(req: Request, res: Response): Promise<void> {
  await logoutUser(req.user!.id);
  res.status(200).json({ message: 'Logged out successfully' });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = parseBody(refreshSchema, req.body);
  const result = await refreshSession(refreshToken);
  res.status(200).json(result);
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = parseBody(forgotPasswordSchema, req.body);
  await requestPasswordReset(email);
  res.status(200).json({
    message: 'If an account exists with that email, a reset link has been sent.',
  });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = parseBody(resetPasswordSchema, req.body);
  await resetPasswordService(token, password);
  res.status(200).json({ message: 'Password has been reset. Please log in.' });
}

export async function register(req: Request, res: Response): Promise<void> {
  if (!env.REGISTRATION_ENABLED) {
    throw new ForbiddenError('Self-registration is not enabled. Contact your administrator.');
  }
  const { email, name, password } = parseBody(registerSchema, req.body);
  const result = await registerUser(email, name, password);
  res.status(201).json(result);
}

export async function verifyEmailHandler(req: Request, res: Response): Promise<void> {
  const { token } = parseBody(verifyEmailSchema, req.body);
  const result = await verifyEmail(
    token,
    req.headers['user-agent'] as string | undefined,
    req.ip,
  );
  res.status(200).json(result);
}

export async function resendVerificationHandler(req: Request, res: Response): Promise<void> {
  const { email } = parseBody(resendVerificationSchema, req.body);
  await resendVerification(email);
  res.status(200).json({ message: 'If your account is pending verification, a new email has been sent.' });
}

export async function acceptInviteHandler(req: Request, res: Response): Promise<void> {
  const { token, password } = parseBody(acceptInviteSchema, req.body);
  const result = await acceptInvite(
    token,
    password,
    req.headers['user-agent'] as string | undefined,
    req.ip,
  );
  res.status(200).json(result);
}
