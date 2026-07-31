import { z } from 'zod';

export const createAssetSchema = z.object({
  assetId: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  category: z.enum(['HARDWARE', 'SOFTWARE', 'DIGITAL', 'INTANGIBLE']),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED', 'LOST']).optional(),
  location: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateAssetSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  category: z.enum(['HARDWARE', 'SOFTWARE', 'DIGITAL', 'INTANGIBLE']).optional(),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED', 'LOST']).optional(),
  location: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).refine(
  (data) => Object.values(data).some(v => v !== undefined),
  { message: 'At least one field must be provided' },
);

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const listAssetsQuerySchema = z.object({
  search: z.string().max(255).optional(),
});
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;
