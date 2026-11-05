import type { Request, Response } from 'express';
import { grantAccessSchema } from './credential-access.validation.js';
import {
  grantCredentialAccess,
  revokeCredentialAccess,
  getCredentialSharing,
} from './credential-access.service.js';
import { checkCredentialAccess } from '../../middleware/requireResourceAccess.js';
import { createAuditLog, requestContext } from '../../services/audit.service.js';
import { parse } from '../../lib/validate.js';
import { PermissionLevel } from '@prisma/client';
import { ConflictError } from '../../lib/errors.js';
import { prisma } from '../../config/database.js';

// Sharing requires MANAGE on the credential (owners, MANAGE-level grantees, SUPER_ADMIN and MANAGER).
async function assertCanShare(req: Request): Promise<string> {
  const credentialId = req.params.credentialId as string;
  await checkCredentialAccess(req.user!.id, req.user!.role as string, credentialId, PermissionLevel.MANAGE);
  return credentialId;
}

export async function grant(req: Request, res: Response): Promise<void> {
  const credentialId = await assertCanShare(req);
  const body = parse(grantAccessSchema, req.body);
  const access = await grantCredentialAccess(credentialId, body.userId, body.permission);
  await createAuditLog({
    userId: req.user!.id,
    action: 'SHARE',
    targetType: 'CREDENTIAL',
    targetId: credentialId,
    metadata: { sharedWith: body.userId, permission: body.permission },
    ...requestContext(req),
  });
  res.status(201).json({ access });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const credentialId = await assertCanShare(req);
  const targetUserId = req.params.userId as string;
  const owner = await prisma.credential.findFirst({ where: { id: credentialId }, select: { createdById: true } });
  if (owner?.createdById === targetUserId) throw new ConflictError("The owner's access cannot be revoked");
  await revokeCredentialAccess(credentialId, targetUserId);
  await createAuditLog({
    userId: req.user!.id,
    action: 'REVOKE_SHARE',
    targetType: 'CREDENTIAL',
    targetId: credentialId,
    metadata: { revokedFrom: targetUserId },
    ...requestContext(req),
  });
  res.status(204).end();
}

export async function list(req: Request, res: Response): Promise<void> {
  const credentialId = await assertCanShare(req);
  res.status(200).json(await getCredentialSharing(credentialId));
}
