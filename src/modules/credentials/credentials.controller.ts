import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { createCredentialSchema, updateCredentialSchema } from './credentials.validation.js';
import {
  createCredential,
  listCredentials,
  getCredential,
  updateCredential,
  deleteCredential,
  revealCredential,
} from './credentials.service.js';
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

export async function create(req: Request, res: Response): Promise<void> {
  const body = parseBody(createCredentialSchema, req.body);
  const credential = await createCredential(body, req.user!.id);
  res.status(201).json({ credential });
}

export async function list(req: Request, res: Response): Promise<void> {
  const credentials = await listCredentials(req.user!.id, req.user!.role as string);
  res.json({ credentials });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const credential = await getCredential(req.params.id as string, req.user!.id, req.user!.role as string);
  res.json({ credential });
}

export async function update(req: Request, res: Response): Promise<void> {
  const body = parseBody(updateCredentialSchema, req.body);
  const credential = await updateCredential(req.params.id as string, body, req.user!.id, req.user!.role as string);
  res.json({ credential });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await deleteCredential(req.params.id as string, req.user!.id, req.user!.role as string);
  res.status(204).end();
}

export async function reveal(req: Request, res: Response): Promise<void> {
  const secret = await revealCredential(req.params.id as string, req.user!.id, req.user!.role as string);
  res.json({ secret });
}
