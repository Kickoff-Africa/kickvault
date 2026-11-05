import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  inviteUserSchema,
  updateUserSchema,
  updateProfileSchema,
  changePasswordSchema,
  listUsersSchema,
  lookupUsersSchema,
  deleteAccountSchema,
  preferencesSchema,
  totpCodeSchema,
  totpDisableSchema,
} from './users.validation.js';
import * as settings from './users.settings.service.js';
import { requestContext } from '../../services/audit.service.js';
import {
  inviteUser,
  resendInvite as resendInviteService,
  listUsers,
  userStats,
  lookupUsers,
  getUserDetails,
  reactivateUser,
  updateUser,
  deactivateUser,
  changeOwnPassword,
  getMyProfile,
  updateMyProfile,
  uploadUserAvatar,
  deleteUserAvatar,
  hardDeleteUser,
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
  const { email, name, role, department } = parseBody(inviteUserSchema, req.body);
  const user = await inviteUser(email, name, role, req.user!.id, department, requestContext(req));
  res.status(201).json({ user });
}

export async function list(req: Request, res: Response): Promise<void> {
  const { page, limit, ...filters } = parseBody(listUsersSchema, req.query);
  const result = await listUsers(page, limit, filters);
  res.status(200).json(result);
}

export async function stats(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await userStats());
}

export async function lookup(req: Request, res: Response): Promise<void> {
  const { search, limit } = parseBody(lookupUsersSchema, req.query);
  res.status(200).json({ users: await lookupUsers(search, limit) });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const user = await getUserDetails(req.params.id as string);
  res.status(200).json({ user });
}

export async function update(req: Request, res: Response): Promise<void> {
  const body = parseBody(updateUserSchema, req.body);
  const user = await updateUser(req.params.id as string, body, req.user!.id, requestContext(req));
  res.status(200).json({ user });
}

export async function hardDelete(req: Request, res: Response): Promise<void> {
  await hardDeleteUser(req.params.id as string, req.user!.id);
  res.status(204).end();
}

export async function deactivate(req: Request, res: Response): Promise<void> {
  const result = await deactivateUser(req.params.id as string, req.user!.id, requestContext(req));
  res.status(200).json(result);
}

export async function reactivate(req: Request, res: Response): Promise<void> {
  const user = await reactivateUser(req.params.id as string, req.user!.id, requestContext(req));
  res.status(200).json({ user });
}

export async function resendInvite(req: Request, res: Response): Promise<void> {
  const user = await resendInviteService(req.params.id as string, req.user!.id);
  res.status(200).json({ user });
}

export async function getProfile(req: Request, res: Response): Promise<void> {
  const user = await getMyProfile(req.user!.id);
  res.json({ user });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const body = parseBody(updateProfileSchema, req.body);
  const user = await updateMyProfile(req.user!.id, body);
  res.json({ user });
}

export async function uploadAvatar(req: Request, res: Response): Promise<void> {
  if (!req.file) throw new ValidationError('No file uploaded');
  const user = await uploadUserAvatar(req.user!.id, req.file.buffer);
  res.json({ user });
}

export async function removeAvatar(req: Request, res: Response): Promise<void> {
  await deleteUserAvatar(req.user!.id);
  res.status(204).end();
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = parseBody(changePasswordSchema, req.body);
  const tokens = await changeOwnPassword(req.user!.id, req.sessionId!, currentPassword, newPassword);
  res.status(200).json({ message: 'Password changed successfully', ...tokens });
}

// ── Settings: preferences, login history, 2FA, account deletion ──

export async function getPreferences(req: Request, res: Response): Promise<void> {
  res.json({ preferences: await settings.getPreferences(req.user!.id) });
}

export async function updatePreferences(req: Request, res: Response): Promise<void> {
  const body = parseBody(preferencesSchema, req.body);
  res.json({ preferences: await settings.updatePreferences(req.user!.id, body) });
}

export async function loginHistory(req: Request, res: Response): Promise<void> {
  res.json({ events: await settings.listLoginHistory(req.user!.id) });
}

export async function totpSetup(req: Request, res: Response): Promise<void> {
  res.status(201).json(await settings.beginTotpSetup(req.user!.id));
}

export async function totpEnable(req: Request, res: Response): Promise<void> {
  const { code } = parseBody(totpCodeSchema, req.body);
  res.json(await settings.confirmTotpSetup(req.user!.id, code));
}

export async function totpDisable(req: Request, res: Response): Promise<void> {
  const { password } = parseBody(totpDisableSchema, req.body);
  res.json(await settings.disableTotp(req.user!.id, password));
}

export async function deleteMe(req: Request, res: Response): Promise<void> {
  const { password } = parseBody(deleteAccountSchema, req.body);
  await settings.deleteOwnAccount(req.user!.id, password);
  res.status(204).end();
}
