import type { Request, Response } from 'express';
import {
  createAssetSchema,
  updateAssetSchema,
  listAssetsQuerySchema,
  checkoutSchema,
  serviceRecordSchema,
  disposeSchema,
  importAssetsSchema,
} from './assets.validation.js';
import {
  createAsset,
  listAssets,
  assetFacets,
  getAsset,
  getAssetFinancials,
  updateAsset,
  deleteAsset,
} from './assets.service.js';
import * as lifecycle from './assets.lifecycle.service.js';
import { importAssets, previewAssetImport } from './assets.import.js';
import { qrPngDataUrl, renderCertificatePdf, renderLabelPdf } from './assets.documents.js';
import { parse } from '../../lib/validate.js';
import { requestContext } from '../../services/audit.service.js';
import { ValidationError } from '../../lib/errors.js';

const actor = (req: Request) => ({ id: req.user!.id, role: req.user!.role as string });
const id = (req: Request) => req.params.id as string;

export async function create(req: Request, res: Response): Promise<void> {
  const asset = await createAsset(parse(createAssetSchema, req.body), req.user!.id, requestContext(req));
  res.status(201).json({ asset });
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = parse(listAssetsQuerySchema, req.query);
  res.json(await listAssets(req.user!.id, req.user!.role as string, query));
}

export async function facets(req: Request, res: Response): Promise<void> {
  res.json(await assetFacets(req.user!.id, req.user!.role as string));
}

export async function getOne(req: Request, res: Response): Promise<void> {
  res.json({ asset: await getAsset(id(req), req.user!.id, req.user!.role as string) });
}

export async function financials(req: Request, res: Response): Promise<void> {
  res.json({ financials: await getAssetFinancials(id(req), req.user!.id, req.user!.role as string) });
}

export async function update(req: Request, res: Response): Promise<void> {
  const asset = await updateAsset(id(req), parse(updateAssetSchema, req.body), req.user!.id, req.user!.role as string, requestContext(req));
  res.json({ asset });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await deleteAsset(id(req), req.user!.id, req.user!.role as string, requestContext(req));
  res.status(204).end();
}

// ── check-out / check-in ──
export async function checkout(req: Request, res: Response): Promise<void> {
  const a = actor(req);
  res.status(201).json({ checkout: await lifecycle.checkoutAsset(id(req), parse(checkoutSchema, req.body), a.id, a.role, requestContext(req)) });
}
export async function checkin(req: Request, res: Response): Promise<void> {
  const a = actor(req);
  res.json({ checkout: await lifecycle.checkinAsset(id(req), a.id, a.role, requestContext(req)) });
}
export async function listCheckouts(req: Request, res: Response): Promise<void> {
  const a = actor(req);
  res.json({ checkouts: await lifecycle.listCheckouts(id(req), a.id, a.role) });
}

// ── service history ──
export async function listServices(req: Request, res: Response): Promise<void> {
  const a = actor(req);
  res.json({ serviceRecords: await lifecycle.listServiceRecords(id(req), a.id, a.role) });
}
export async function addService(req: Request, res: Response): Promise<void> {
  const a = actor(req);
  const record = await lifecycle.addServiceRecord(id(req), parse(serviceRecordSchema, req.body), a.id, a.role, requestContext(req));
  res.status(201).json({ serviceRecord: record });
}
export async function removeService(req: Request, res: Response): Promise<void> {
  const a = actor(req);
  await lifecycle.deleteServiceRecord(id(req), req.params.recordId as string, a.id, a.role, requestContext(req));
  res.status(204).end();
}

// ── attachments ──
export async function listAttachments(req: Request, res: Response): Promise<void> {
  const a = actor(req);
  res.json({ attachments: await lifecycle.listAttachments(id(req), a.id, a.role) });
}
export async function addAttachment(req: Request, res: Response): Promise<void> {
  if (!req.file) throw new ValidationError('No file uploaded (multipart field "file")');
  const a = actor(req);
  res.status(201).json({ attachment: await lifecycle.addAttachment(id(req), req.file, a.id, a.role, requestContext(req)) });
}
export async function downloadAttachment(req: Request, res: Response): Promise<void> {
  const a = actor(req);
  res.json(await lifecycle.getAttachmentDownload(id(req), req.params.attachmentId as string, a.id, a.role));
}
export async function removeAttachment(req: Request, res: Response): Promise<void> {
  const a = actor(req);
  await lifecycle.deleteAttachment(id(req), req.params.attachmentId as string, a.id, a.role, requestContext(req));
  res.status(204).end();
}

// ── dispose / certificate / label ──
export async function dispose(req: Request, res: Response): Promise<void> {
  const a = actor(req);
  res.status(201).json({ certificate: await lifecycle.disposeAsset(id(req), parse(disposeSchema, req.body), a.id, a.role, requestContext(req)) });
}
export async function certificate(req: Request, res: Response): Promise<void> {
  const a = actor(req);
  const cert = await lifecycle.getCertificate(id(req), a.id, a.role);
  if (req.query.format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${cert.reference}.pdf"`);
    res.send(await renderCertificatePdf(cert));
    return;
  }
  res.json({ certificate: cert });
}
export async function label(req: Request, res: Response): Promise<void> {
  const a = actor(req);
  const data = await lifecycle.getLabelData(id(req), a.id, a.role);
  if (req.query.format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${data.assetId}-label.pdf"`);
    res.send(await renderLabelPdf(data));
    return;
  }
  res.json({ label: { ...data, qrDataUrl: await qrPngDataUrl(data.qrPayload) } });
}

// ── CSV import ──
export async function importPreview(req: Request, res: Response): Promise<void> {
  res.json(await previewAssetImport(parse(importAssetsSchema, req.body).csv));
}
export async function importCsv(req: Request, res: Response): Promise<void> {
  res.status(201).json(await importAssets(parse(importAssetsSchema, req.body).csv, req.user!.id, requestContext(req)));
}
