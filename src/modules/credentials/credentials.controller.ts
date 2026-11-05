import type { Request, Response } from 'express';
import {
  createCredentialSchema,
  updateCredentialSchema,
  listCredentialsQuerySchema,
  revealBodySchema,
  generateSecretSchema,
  importCredentialsSchema,
} from './credentials.validation.js';
import * as svc from './credentials.service.js';
import { importCredentials, previewCredentialImport } from './credentials.import.js';
import { parse } from '../../lib/validate.js';
import { requestContext } from '../../services/audit.service.js';

const id = (req: Request) => req.params.id as string;
const who = (req: Request) => ({ userId: req.user!.id, role: req.user!.role as string });
const revealOpts = (req: Request) => ({
  password: parse(revealBodySchema, req.body).password,
  viaApiKey: !!req.apiKey,
  apiKeyId: req.apiKey?.id,
});

export async function create(req: Request, res: Response): Promise<void> {
  const credential = await svc.createCredential(parse(createCredentialSchema, req.body), req.user!.id, requestContext(req));
  res.status(201).json({ credential });
}

export async function list(req: Request, res: Response): Promise<void> {
  const { userId, role } = who(req);
  res.json({ credentials: await svc.listCredentials(userId, role, parse(listCredentialsQuerySchema, req.query)) });
}

export async function facets(req: Request, res: Response): Promise<void> {
  const { userId, role } = who(req);
  res.json(await svc.credentialFacets(userId, role));
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { userId, role } = who(req);
  res.json({ credential: await svc.getCredential(id(req), userId, role) });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { userId, role } = who(req);
  const credential = await svc.updateCredential(id(req), parse(updateCredentialSchema, req.body), userId, role, requestContext(req));
  res.json({ credential });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { userId, role } = who(req);
  await svc.deleteCredential(id(req), userId, role, requestContext(req));
  res.status(204).end();
}

export async function reveal(req: Request, res: Response): Promise<void> {
  const { userId, role } = who(req);
  res.json({ secret: await svc.revealCredential(id(req), userId, role, revealOpts(req), requestContext(req)) });
}

export async function copy(req: Request, res: Response): Promise<void> {
  const { userId, role } = who(req);
  res.json({ secret: await svc.copyCredential(id(req), userId, role, revealOpts(req), requestContext(req)) });
}

export async function versions(req: Request, res: Response): Promise<void> {
  const { userId, role } = who(req);
  res.json({ versions: await svc.listVersions(id(req), userId, role) });
}

export async function restore(req: Request, res: Response): Promise<void> {
  const { userId, role } = who(req);
  res.json({ versions: await svc.restoreVersion(id(req), req.params.versionId as string, userId, role, requestContext(req)) });
}

export async function revealVersion(req: Request, res: Response): Promise<void> {
  const { userId, role } = who(req);
  const secret = await svc.revealVersion(id(req), req.params.versionId as string, userId, role, revealOpts(req), requestContext(req));
  res.json({ secret });
}

export async function generate(req: Request, res: Response): Promise<void> {
  const { length, symbols } = parse(generateSecretSchema, req.body ?? {});
  res.json({ secret: svc.generateSecret(length, symbols) });
}

export async function importPreview(req: Request, res: Response): Promise<void> {
  res.json(previewCredentialImport(parse(importCredentialsSchema, req.body).csv));
}

export async function importCsv(req: Request, res: Response): Promise<void> {
  res.status(201).json(await importCredentials(parse(importCredentialsSchema, req.body).csv, req.user!.id, requestContext(req)));
}
