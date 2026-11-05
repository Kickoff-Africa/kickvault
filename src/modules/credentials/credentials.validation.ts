import { z } from 'zod';

export const CREDENTIAL_TYPES = [
  'LOGIN',
  'API_KEY',
  'SSH_KEY',
  'SOFTWARE_LICENSE',
  'TOKEN',
  'CERTIFICATE',
  'OTHER',
] as const;
export type CredentialTypeValue = (typeof CREDENTIAL_TYPES)[number];

/** Turn "API Key", "api-key" or "API_KEY" into the enum value, or undefined when unknown. */
export function normalizeCredType(raw: string): CredentialTypeValue | undefined {
  const v = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (CREDENTIAL_TYPES as readonly string[]).includes(v) ? (v as CredentialTypeValue) : undefined;
}

export const createCredentialSchema = z.object({
  friendlyName: z.string().min(1).max(255),
  credType: z.enum(CREDENTIAL_TYPES).default('OTHER'),
  systemHost: z.string().min(1).max(255).optional(),
  username: z.string().min(1).max(255).optional(),
  secret: z.string().min(1),
  policyRef: z.string().max(255).optional(),
  expiresAt: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
});

export const updateCredentialSchema = z
  .object({
    friendlyName: z.string().min(1).max(255).optional(),
    credType: z.enum(CREDENTIAL_TYPES).optional(),
    systemHost: z.string().min(1).max(255).nullable().optional(),
    username: z.string().min(1).max(255).nullable().optional(),
    secret: z.string().min(1).optional(),
    policyRef: z.string().max(255).nullable().optional(),
    expiresAt: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;

export const listCredentialsQuerySchema = z.object({
  search: z.string().max(255).optional(),
  /** Comma-separated credential types. */
  credType: z.string().max(200).optional(),
  expiring_within: z.string().regex(/^\d+d$/, 'Must be in format like "30d"').optional(),
});
export type ListCredentialsQuery = z.infer<typeof listCredentialsQuerySchema>;

/** Body of reveal/copy; `password` is only needed when the user enabled re-authentication. */
export const revealBodySchema = z.object({ password: z.string().optional() }).default({});

export const generateSecretSchema = z.object({
  length: z.coerce.number().int().min(8).max(128).default(20),
  symbols: z.boolean().default(true),
});

export const importCredentialsSchema = z.object({
  csv: z.string().min(1).max(1_000_000),
});
