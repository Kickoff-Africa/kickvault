import { z } from 'zod';

export const createCredentialSchema = z.object({
  friendlyName: z.string().min(1).max(255),
  systemHost: z.string().min(1).max(255).optional(),
  username: z.string().min(1).max(255).optional(),
  secret: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});

export const updateCredentialSchema = z.object({
  friendlyName: z.string().min(1).max(255).optional(),
  systemHost: z.string().min(1).max(255).nullable().optional(),
  username: z.string().min(1).max(255).nullable().optional(),
  secret: z.string().min(1).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).refine(
  (data) => Object.values(data).some(v => v !== undefined),
  { message: 'At least one field must be provided' },
);

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;
