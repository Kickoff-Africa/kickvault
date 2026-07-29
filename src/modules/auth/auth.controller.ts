import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.validation.js';
import {
  loginUser,
  logoutUser,
  refreshSession,
  requestPasswordReset,
  resetPassword as resetPasswordService,
} from './auth.service.js';
import { ValidationError } from '../../lib/errors.js';

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
