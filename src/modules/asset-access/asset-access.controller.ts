import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { grantAccessSchema } from './asset-access.validation.js';
import {
  grantAssetAccess,
  revokeAssetAccess,
  listAssetAccess,
} from './asset-access.service.js';
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
  const access = await grantAssetAccess(
    req.params.assetId as string,
    body.userId,
    body.permission,
  );
  res.status(201).json({ access });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  await revokeAssetAccess(
    req.params.assetId as string,
    req.params.userId as string,
  );
  res.status(204).end();
}

export async function list(req: Request, res: Response): Promise<void> {
  const access = await listAssetAccess(req.params.assetId as string);
  res.status(200).json({ access });
}
