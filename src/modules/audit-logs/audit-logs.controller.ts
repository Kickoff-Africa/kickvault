import type { Request, Response } from 'express';
import { listAuditLogsQuerySchema, exportAuditLogsQuerySchema, facetsQuerySchema } from './audit-logs.validation.js';
import { listAuditLogs, getAuditLog, auditFacets, exportAuditLogs } from './audit-logs.service.js';
import { parse } from '../../lib/validate.js';

export async function list(req: Request, res: Response): Promise<void> {
  res.json(await listAuditLogs(parse(listAuditLogsQuerySchema, req.query)));
}

export async function facets(req: Request, res: Response): Promise<void> {
  res.json(await auditFacets(parse(facetsQuerySchema, req.query)));
}

export async function getOne(req: Request, res: Response): Promise<void> {
  res.json({ log: await getAuditLog(req.params.id as string) });
}

export async function exportLogs(req: Request, res: Response): Promise<void> {
  const out = await exportAuditLogs(parse(exportAuditLogsQuerySchema, req.query));
  res.setHeader('Content-Type', out.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.send(out.body);
}

// Back-compat alias for the previous controller export name.
export { exportLogs as exportCsv };
