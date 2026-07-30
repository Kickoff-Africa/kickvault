import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  listAuditLogsQuerySchema,
  exportAuditLogsQuerySchema,
} from './audit-logs.validation.js';
import { listAuditLogs, exportAuditLogsCsv } from './audit-logs.service.js';
import { ValidationError } from '../../lib/errors.js';

function parseQuery<T>(schema: { parse: (data: unknown) => T }, query: unknown): T {
  try {
    return schema.parse(query);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ValidationError(err.issues[0].message);
    }
    throw err;
  }
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = parseQuery(listAuditLogsQuerySchema, req.query);
  const result = await listAuditLogs(query);
  res.json(result);
}

export async function exportCsv(req: Request, res: Response): Promise<void> {
  const query = parseQuery(exportAuditLogsQuerySchema, req.query);
  const csv = await exportAuditLogsCsv(query);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
  res.send(csv);
}
