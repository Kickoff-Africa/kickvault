import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { dashboardQuerySchema } from './dashboard.validation.js';
import { getDashboardStats } from './dashboard.service.js';
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

export async function stats(req: Request, res: Response): Promise<void> {
  const query = parseQuery(dashboardQuerySchema, req.query);
  const result = await getDashboardStats(query.expiring_threshold);
  res.json({ ...result });
}
