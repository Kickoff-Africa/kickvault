import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { createAssetSchema, updateAssetSchema, listAssetsQuerySchema } from './assets.validation.js';
import {
  createAsset,
  listAssets,
  getAsset,
  updateAsset,
  deleteAsset,
} from './assets.service.js';
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

function parseQuery<T>(schema: { parse: (data: unknown) => T }, query: unknown): T {
  try { return schema.parse(query); }
  catch (err) {
    if (err instanceof ZodError) throw new ValidationError(err.issues[0].message);
    throw err;
  }
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = parseBody(createAssetSchema, req.body);
  const asset = await createAsset(body, req.user!.id);
  res.status(201).json({ asset });
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = parseQuery(listAssetsQuerySchema, req.query);
  const assets = await listAssets(req.user!.id, req.user!.role as string, query);
  res.json({ assets });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const asset = await getAsset(req.params.id as string, req.user!.id, req.user!.role as string);
  res.json({ asset });
}

export async function update(req: Request, res: Response): Promise<void> {
  const body = parseBody(updateAssetSchema, req.body);
  const asset = await updateAsset(req.params.id as string, body, req.user!.id, req.user!.role as string);
  res.json({ asset });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await deleteAsset(req.params.id as string, req.user!.id, req.user!.role as string);
  res.status(204).end();
}
