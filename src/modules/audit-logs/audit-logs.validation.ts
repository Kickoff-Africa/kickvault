import { z } from 'zod';

export const listAuditLogsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'REVEAL']).optional(),
  userId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

export const exportAuditLogsQuerySchema = z.object({
  action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'REVEAL']).optional(),
  userId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export type ExportAuditLogsQuery = z.infer<typeof exportAuditLogsQuerySchema>;
