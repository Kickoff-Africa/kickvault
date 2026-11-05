import { createHash, randomBytes } from 'node:crypto';
import { PermissionLevel, Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { checkAssetAccess } from '../../middleware/requireResourceAccess.js';
import { createAuditLog, type AuditParams } from '../../services/audit.service.js';
import { deletePrivateFile, signedDownloadUrl, uploadPrivateFile } from '../../lib/cloudinary.js';
import { logger } from '../../lib/logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { getAssetRecord } from './assets.service.js';
import type { CheckoutInput, DisposeInput, ServiceRecordInput } from './assets.validation.js';

type Ctx = Pick<AuditParams, 'ipAddress' | 'userAgent'>;

const asDate = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);
const todayUtc = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

// ─── Check-out / check-in ─────────────────────────────────────────────────────

function checkoutStatus(c: { returnedAt: Date | null; dueDate: Date }): 'ACTIVE' | 'OVERDUE' | 'RETURNED' {
  if (c.returnedAt) return 'RETURNED';
  return c.dueDate < todayUtc() ? 'OVERDUE' : 'ACTIVE';
}

export async function checkoutAsset(assetId: string, input: CheckoutInput, userId: string, userRole: string, ctx: Ctx = {}) {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.MANAGE);
  const asset = await getAssetRecord(assetId);
  if (asset.status !== 'ACTIVE') throw new ConflictError(`Only ACTIVE assets can be checked out (this one is ${asset.status})`);

  const open = await prisma.assetCheckout.findFirst({ where: { assetId, returnedAt: null }, select: { id: true } });
  if (open) throw new ConflictError('Asset is already checked out');

  const due = asDate(input.dueDate);
  if (due < todayUtc()) throw new ValidationError('Return due date cannot be in the past');

  const assignee = await prisma.user.findFirst({
    where: { id: input.assigneeId, deletedAt: null, isActive: true },
    select: { id: true, name: true },
  });
  if (!assignee) throw new NotFoundError('Assignee not found');

  const existingAccess = await prisma.assetAccess.findUnique({
    where: { userId_assetId: { userId: assignee.id, assetId } },
    select: { id: true },
  });

  const checkout = await prisma.$transaction(async (tx) => {
    if (!existingAccess) {
      await tx.assetAccess.create({ data: { userId: assignee.id, assetId, permission: PermissionLevel.VIEW } });
    }
    await tx.asset.update({ where: { id: assetId }, data: { assigneeId: assignee.id, recoveryRequestedAt: null } });
    return tx.assetCheckout.create({
      data: { assetId, assigneeId: assignee.id, checkedOutById: userId, dueDate: due, accessGranted: !existingAccess },
    });
  });

  await createAuditLog({
    userId,
    action: 'CHECKOUT',
    targetType: 'ASSET',
    targetId: assetId,
    metadata: { assigneeId: assignee.id, dueDate: input.dueDate },
    ...ctx,
  });
  return serializeCheckout({ ...checkout, assignee });
}

async function closeCheckout(checkoutId: string, auto: boolean) {
  const checkout = await prisma.assetCheckout.findUnique({ where: { id: checkoutId } });
  if (!checkout || checkout.returnedAt) return null;
  await prisma.$transaction(async (tx) => {
    await tx.assetCheckout.update({ where: { id: checkoutId }, data: { returnedAt: new Date(), autoReturned: auto } });
    await tx.asset.updateMany({ where: { id: checkout.assetId, assigneeId: checkout.assigneeId }, data: { assigneeId: null } });
    if (checkout.accessGranted) {
      await tx.assetAccess.deleteMany({ where: { assetId: checkout.assetId, userId: checkout.assigneeId } });
    }
  });
  return checkout;
}

export async function checkinAsset(assetId: string, userId: string, userRole: string, ctx: Ctx = {}) {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.MANAGE);
  await getAssetRecord(assetId);
  const open = await prisma.assetCheckout.findFirst({ where: { assetId, returnedAt: null } });
  if (!open) throw new ConflictError('Asset is not checked out');
  await closeCheckout(open.id, false);
  await createAuditLog({
    userId,
    action: 'CHECKIN',
    targetType: 'ASSET',
    targetId: assetId,
    metadata: { assigneeId: open.assigneeId },
    ...ctx,
  });
  const updated = await prisma.assetCheckout.findUniqueOrThrow({
    where: { id: open.id },
    include: { /* no relations */ },
  });
  const assignee = await prisma.user.findUnique({ where: { id: open.assigneeId }, select: { id: true, name: true } });
  return serializeCheckout({ ...updated, assignee });
}

/** Close checkouts whose due date has passed and revoke the access they granted. Runs on a timer from server.ts. */
export async function expireOverdueCheckouts(): Promise<number> {
  const overdue = await prisma.assetCheckout.findMany({
    where: { returnedAt: null, dueDate: { lt: todayUtc() } },
    select: { id: true, assetId: true, checkedOutById: true, assigneeId: true },
  });
  let closed = 0;
  for (const c of overdue) {
    try {
      if (await closeCheckout(c.id, true)) {
        closed++;
        await createAuditLog({
          userId: c.checkedOutById,
          action: 'CHECKIN',
          targetType: 'ASSET',
          targetId: c.assetId,
          metadata: { assigneeId: c.assigneeId, auto: true, reason: 'due date passed' },
        });
      }
    } catch (err) {
      logger.error({ err, checkoutId: c.id }, 'Failed to expire checkout');
    }
  }
  return closed;
}

function serializeCheckout(c: {
  id: string;
  assetId: string;
  assigneeId: string;
  checkedOutAt: Date;
  dueDate: Date;
  returnedAt: Date | null;
  autoReturned: boolean;
  assignee?: { id: string; name: string } | null;
}) {
  return {
    id: c.id,
    assetId: c.assetId,
    assignee: c.assignee ?? { id: c.assigneeId, name: null },
    checkedOutAt: c.checkedOutAt,
    dueDate: c.dueDate.toISOString().slice(0, 10),
    returnedAt: c.returnedAt,
    autoReturned: c.autoReturned,
    status: checkoutStatus(c),
  };
}

export async function listCheckouts(assetId: string, userId: string, userRole: string) {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.VIEW);
  await getAssetRecord(assetId);
  const rows = await prisma.assetCheckout.findMany({ where: { assetId }, orderBy: { checkedOutAt: 'desc' } });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.assigneeId))] } },
    select: { id: true, name: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => serializeCheckout({ ...r, assignee: byId.get(r.assigneeId) ?? null }));
}

// ─── Service history ──────────────────────────────────────────────────────────

const serializeService = (r: { id: string; serviceDate: Date; technician: string; description: string; cost: Prisma.Decimal; createdAt: Date }) => ({
  id: r.id,
  serviceDate: r.serviceDate.toISOString().slice(0, 10),
  technician: r.technician,
  description: r.description,
  cost: Number(r.cost),
  createdAt: r.createdAt,
});

export async function listServiceRecords(assetId: string, userId: string, userRole: string) {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.VIEW);
  await getAssetRecord(assetId);
  const rows = await prisma.assetServiceRecord.findMany({ where: { assetId }, orderBy: { serviceDate: 'desc' } });
  return rows.map(serializeService);
}

export async function addServiceRecord(assetId: string, input: ServiceRecordInput, userId: string, userRole: string, ctx: Ctx = {}) {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.EDIT);
  const asset = await getAssetRecord(assetId);
  if (asset.status === 'DISPOSED') throw new ConflictError('Disposed assets cannot be serviced');
  const record = await prisma.assetServiceRecord.create({
    data: {
      assetId,
      serviceDate: asDate(input.serviceDate),
      technician: input.technician,
      description: input.description,
      cost: input.cost,
      createdById: userId,
    },
  });
  await createAuditLog({ userId, action: 'EDIT', targetType: 'ASSET', targetId: assetId, metadata: { serviceRecordId: record.id }, ...ctx });
  return serializeService(record);
}

export async function deleteServiceRecord(assetId: string, recordId: string, userId: string, userRole: string, ctx: Ctx = {}) {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.EDIT);
  const res = await prisma.assetServiceRecord.deleteMany({ where: { id: recordId, assetId } });
  if (res.count === 0) throw new NotFoundError('Service record not found');
  await createAuditLog({ userId, action: 'EDIT', targetType: 'ASSET', targetId: assetId, metadata: { serviceRecordDeleted: recordId }, ...ctx });
}

// ─── Attachments ──────────────────────────────────────────────────────────────

const serializeAttachment = (a: { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: Date; uploadedById: string }) => ({
  id: a.id,
  fileName: a.fileName,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
  uploadedById: a.uploadedById,
  createdAt: a.createdAt,
});

export async function listAttachments(assetId: string, userId: string, userRole: string) {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.VIEW);
  await getAssetRecord(assetId);
  const rows = await prisma.assetAttachment.findMany({ where: { assetId }, orderBy: { createdAt: 'desc' } });
  return rows.map(serializeAttachment);
}

export async function addAttachment(
  assetId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  userId: string,
  userRole: string,
  ctx: Ctx = {},
) {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.EDIT);
  const asset = await getAssetRecord(assetId);
  if (asset.status === 'DISPOSED') throw new ConflictError('Disposed assets cannot receive attachments');
  const uploaded = await uploadPrivateFile(file.buffer, `assets/${assetId}`);
  const row = await prisma.assetAttachment.create({
    data: {
      assetId,
      fileName: file.originalname.slice(0, 255),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      url: uploaded.url,
      publicId: uploaded.publicId,
      resourceType: uploaded.resourceType,
      uploadedById: userId,
    },
  });
  await createAuditLog({ userId, action: 'EDIT', targetType: 'ASSET', targetId: assetId, metadata: { attachmentId: row.id }, ...ctx });
  return serializeAttachment(row);
}

/** Returns a short-lived signed URL; attachments are never publicly reachable. */
export async function getAttachmentDownload(assetId: string, attachmentId: string, userId: string, userRole: string) {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.VIEW);
  const row = await prisma.assetAttachment.findFirst({ where: { id: attachmentId, assetId } });
  if (!row) throw new NotFoundError('Attachment not found');
  return { fileName: row.fileName, url: signedDownloadUrl(row.publicId, row.resourceType), expiresInSeconds: 300 };
}

export async function deleteAttachment(assetId: string, attachmentId: string, userId: string, userRole: string, ctx: Ctx = {}) {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.EDIT);
  const row = await prisma.assetAttachment.findFirst({ where: { id: attachmentId, assetId } });
  if (!row) throw new NotFoundError('Attachment not found');
  await deletePrivateFile(row.publicId, row.resourceType).catch((err) => logger.warn({ err }, 'Cloud file delete failed'));
  await prisma.assetAttachment.delete({ where: { id: row.id } });
  await createAuditLog({ userId, action: 'EDIT', targetType: 'ASSET', targetId: assetId, metadata: { attachmentDeleted: attachmentId }, ...ctx });
}

// ─── Retire & dispose ─────────────────────────────────────────────────────────

export interface Certificate {
  reference: string;
  assetId: string;
  assetName: string;
  serialNumber: string | null;
  sanitizationDate: string;
  method: string;
  wipedBy: string;
  notes: string | null;
  verificationHash: string;
  generatedAt: string;
}

const METHOD_LABELS: Record<string, string> = {
  NIST_SP_800_88: 'NIST SP 800-88 Rev. 1',
  DOD_5220_22_M: 'DoD 5220.22-M Wipe Protocol',
  PHYSICAL_DESTRUCTION: 'Physical Destruction',
  FACTORY_RESET: 'Factory Reset',
  DEGAUSSING: 'Degaussing',
};
export const wipeMethodLabel = (m: string) => METHOD_LABELS[m] ?? m;

export async function disposeAsset(assetId: string, input: DisposeInput, userId: string, userRole: string, ctx: Ctx = {}) {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.MANAGE);
  const asset = await getAssetRecord(assetId);
  if (asset.status === 'DISPOSED') throw new ConflictError('Asset has already been disposed');

  const open = await prisma.assetCheckout.findFirst({ where: { assetId, returnedAt: null }, select: { id: true } });
  if (open) await closeCheckout(open.id, false);

  const disposedAt = input.disposalDate ? asDate(input.disposalDate) : new Date();
  const reference = `CERT-DISP-${randomBytes(4).toString('hex').toUpperCase()}`;
  const verificationHash = createHash('sha256')
    .update(JSON.stringify([reference, asset.assetId, asset.serialNumber, input.wipeMethod, input.wipedBy, disposedAt.toISOString()]))
    .digest('hex');

  await prisma.asset.update({
    where: { id: assetId },
    data: {
      status: 'DISPOSED',
      disposedAt,
      disposedById: userId,
      wipedBy: input.wipedBy,
      wipeMethod: input.wipeMethod,
      disposalNotes: input.notes ?? null,
      certificateRef: reference,
      certificateHash: verificationHash,
      assigneeId: null,
    },
  });

  await createAuditLog({
    userId,
    action: 'DISPOSAL',
    targetType: 'ASSET',
    targetId: assetId,
    metadata: { certificateRef: reference, wipeMethod: input.wipeMethod },
    ...ctx,
  });
  return getCertificate(assetId, userId, userRole);
}

export async function getCertificate(assetId: string, userId: string, userRole: string): Promise<Certificate> {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.VIEW);
  const asset = await getAssetRecord(assetId);
  if (asset.status !== 'DISPOSED' || !asset.certificateRef || !asset.disposedAt || !asset.wipeMethod || !asset.wipedBy) {
    throw new NotFoundError('No certificate exists for this asset');
  }
  return {
    reference: asset.certificateRef,
    assetId: asset.assetId,
    assetName: asset.name,
    serialNumber: asset.serialNumber,
    sanitizationDate: asset.disposedAt.toISOString().slice(0, 10),
    method: wipeMethodLabel(asset.wipeMethod),
    wipedBy: asset.wipedBy,
    notes: asset.disposalNotes,
    verificationHash: asset.certificateHash ?? '',
    generatedAt: new Date().toISOString(),
  };
}

// ─── Barcode label ────────────────────────────────────────────────────────────

export async function getLabelData(assetId: string, userId: string, userRole: string) {
  await checkAssetAccess(userId, userRole, assetId, PermissionLevel.VIEW);
  const asset = await getAssetRecord(assetId);
  return {
    id: asset.id,
    assetId: asset.assetId,
    name: asset.name,
    assignee: asset.assignee?.name ?? null,
    department: asset.department?.name ?? null,
    /** What the QR code encodes; scanners can resolve it to the asset record. */
    qrPayload: asset.assetId,
  };
}
