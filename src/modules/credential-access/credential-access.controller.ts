import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { grantAccessSchema } from './credential-access.validation.js';
import {
  grantCredentialAccess,
  revokeCredentialAccess,
  listCredentialAccess,
} from './credential-access.service.js';
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

export async function grant(req: Request, res: Response): Promise<void> {
  const body = parseBody(grantAccessSchema, req.body);
  const access = await grantCredentialAccess(
    req.params.credentialId as string,
    body.userId,
    body.permission,
  );
  res.status(201).json({ access });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  await revokeCredentialAccess(
    req.params.credentialId as string,
    req.params.userId as string,
  );
  res.status(204).end();
}

export async function list(req: Request, res: Response): Promise<void> {
  const access = await listCredentialAccess(req.params.credentialId as string);
  res.status(200).json({ access });
}
