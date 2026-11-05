import { z } from 'zod';

const PERMISSIONS = ['VIEW', 'COPY', 'EDIT', 'MANAGE'] as const;

export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  memberIds: z.array(z.string().min(1)).max(500).default([]),
});

export const updateTeamSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    /** Replaces the full member list. */
    memberIds: z.array(z.string().min(1)).max(500).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'At least one field must be provided' });

export const listTeamsQuerySchema = z.object({
  search: z.string().max(255).optional(),
});

export const assignAssetSchema = z.object({
  assetId: z.string().min(1),
  permission: z.enum(PERMISSIONS).default('VIEW'),
});

export const assignCredentialSchema = z.object({
  credentialId: z.string().min(1),
  permission: z.enum(PERMISSIONS).default('VIEW'),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
