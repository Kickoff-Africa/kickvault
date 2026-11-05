import type { Request, Response } from 'express';
import { PermissionLevel } from '@prisma/client';
import { grantAccessSchema } from './asset-access.validation.js';
import { grantAssetAccess, revokeAssetAccess, getAssetSharing } from './asset-access.service.js';
import { checkAssetAccess } from '../../middleware/requireResourceAccess.js';
import { createAuditLog, requestContext } from '../../services/audit.service.js';
import { parse } from '../../lib/validate.js';

// Sharing requires MANAGE on the asset (creator, MANAGE-level grantees, SUPER_ADMIN and MANAGER).
async function assertCanShare(req: Request): Promise<string> {
  const assetId = req.params.assetId as string;
  await checkAssetAccess(req.user!.id, req.user!.role as string, assetId, PermissionLevel.MANAGE);
  return assetId;
}

export async function grant(req: Request, res: Response): Promise<void> {
  const assetId = await assertCanShare(req);
  const body = parse(grantAccessSchema, req.body);
  const access = await grantAssetAccess(assetId, body.userId, body.permission);
  await createAuditLog({
    userId: req.user!.id,
    action: 'SHARE',
    targetType: 'ASSET',
    targetId: assetId,
    metadata: { sharedWith: body.userId, permission: body.permission },
    ...requestContext(req),
  });
  res.status(201).json({ access });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const assetId = await assertCanShare(req);
  await revokeAssetAccess(assetId, req.params.userId as string);
  await createAuditLog({
    userId: req.user!.id,
    action: 'REVOKE_SHARE',
    targetType: 'ASSET',
    targetId: assetId,
    metadata: { revokedFrom: req.params.userId as string },
    ...requestContext(req),
  });
  res.status(204).end();
}

export async function list(req: Request, res: Response): Promise<void> {
  const assetId = await assertCanShare(req);
  res.status(200).json(await getAssetSharing(assetId));
}
