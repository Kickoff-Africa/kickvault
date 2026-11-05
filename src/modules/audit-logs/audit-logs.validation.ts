import { z } from 'zod';

const filters = {
  /** Comma-separated actions, e.g. "CREATE,EDIT". */
  action: z.string().max(500).optional(),
  /** Comma-separated entity types, e.g. "CREDENTIAL,ASSET". */
  entityType: z.string().max(200).optional(),
  userId: z.string().optional(),
  /** Free text over user name/email, action, entity type and target ID. */
  search: z.string().max(255).optional(),
  startDate: z.iso.datetime({ offset: true }).optional(),
  endDate: z.iso.datetime({ offset: true }).optional(),
};

export const listAuditLogsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  ...filters,
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

export const exportAuditLogsQuerySchema = z.object({
  format: z.enum(['csv', 'pdf']).default('csv'),
  ...filters,
});
export type ExportAuditLogsQuery = z.infer<typeof exportAuditLogsQuerySchema>;

export const facetsQuerySchema = z.object({
  entityType: filters.entityType,
  userId: filters.userId,
  startDate: filters.startDate,
  endDate: filters.endDate,
});
export type AuditFacetsQuery = z.infer<typeof facetsQuerySchema>;
