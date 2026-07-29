import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  inviteUserSchema,
  updateUserSchema,
  changePasswordSchema,
  listUsersSchema,
} from './users.validation.js';
import {
  inviteUser,
  resendInvite as resendInviteService,
  listUsers,
  getUserById,
  updateUser,
  deactivateUser,
  changeOwnPassword,
} from './users.service.js';
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

export async function invite(req: Request, res: Response): Promise<void> {
  const { email, name, role } = parseBody(inviteUserSchema, req.body);
  const user = await inviteUser(email, name, role, req.user!.id);
  res.status(201).json({ user });
}

export async function list(req: Request, res: Response): Promise<void> {
  const { page, limit } = parseBody(listUsersSchema, req.query);
  const result = await listUsers(page, limit);
  res.status(200).json(result);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const user = await getUserById(req.params.id as string);
  res.status(200).json({ user });
}

export async function update(req: Request, res: Response): Promise<void> {
  const body = parseBody(updateUserSchema, req.body);
  const user = await updateUser(req.params.id as string, body, req.user!.id);
  res.status(200).json({ user });
}

export async function deactivate(req: Request, res: Response): Promise<void> {
  const user = await deactivateUser(req.params.id as string, req.user!.id);
  res.status(200).json({ user });
}

export async function resendInvite(req: Request, res: Response): Promise<void> {
  const user = await resendInviteService(req.params.id as string, req.user!.id);
  res.status(200).json({ user });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = parseBody(changePasswordSchema, req.body);
  await changeOwnPassword(req.user!.id, req.sessionId!, currentPassword, newPassword);
  res.status(200).json({ message: 'Password changed successfully' });
}
