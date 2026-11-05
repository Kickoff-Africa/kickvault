import { z } from 'zod';

export const createRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ASSET_ACCESS'),
    assetId: z.string().min(1),
    reason: z.string().trim().min(1).max(200),
  }),
  z.object({
    type: z.literal('CREDENTIAL_ACCESS'),
    credentialId: z.string().min(1),
    reason: z.string().trim().min(1).max(200),
  }),
  z.object({
    type: z.literal('PURCHASE'),
    itemDescription: z.string().trim().min(1).max(500),
    purchaseCost: z.number().nonnegative().max(1e12).optional(),
    /** Category name, case-insensitive. */
    category: z.string().trim().min(1).max(100),
    justification: z.string().trim().max(2000).optional(),
  }),
]);
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const listRequestsQuerySchema = z.object({
  /** Comma-separated: PENDING, APPROVED, DENIED, CANCELLED. */
  status: z.string().max(200).optional(),
  /** Comma-separated: ASSET_ACCESS, CREDENTIAL_ACCESS, PURCHASE. */
  type: z.string().max(200).optional(),
  search: z.string().max(255).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

export const approveRequestSchema = z.object({
  /** Permission granted on approval of an access request. */
  permission: z.enum(['VIEW', 'COPY', 'EDIT', 'MANAGE']).default('VIEW'),
  note: z.string().trim().max(500).optional(),
});

export const denyRequestSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
