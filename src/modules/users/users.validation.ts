import { z } from 'zod';
import { Role } from '@prisma/client';

export const inviteUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.nativeEnum(Role),
  /** Department name (created if it does not exist yet). */
  department: z.string().trim().min(1).max(100).optional(),
});

export const updateUserSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    role: z.nativeEnum(Role).optional(),
    department: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field required',
  });

export const updateProfileSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    phone: z.string().max(30).nullable().optional(),
    department: z.string().max(100).nullable().optional(),
    location: z.string().max(255).nullable().optional(),
    bio: z.string().max(1000).nullable().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field required',
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'Password must be at least 12 characters'),
});

export const listUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Matches name or email. */
  search: z.string().max(255).optional(),
  /** Comma-separated roles, e.g. "MANAGER,MEMBER". */
  role: z.string().max(200).optional(),
  /** Comma-separated: ACTIVE, PENDING, DEACTIVATED. */
  status: z.string().max(200).optional(),
  department: z.string().max(200).optional(),
});

export const lookupUsersSchema = z.object({
  search: z.string().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const deleteAccountSchema = z.object({ password: z.string().min(1) });

export const preferencesSchema = z
  .object({
    notifications: z
      .object({
        transactionAlerts: z.boolean(),
        credentialRevealEvents: z.boolean(),
        expiryWarnings: z.boolean(),
        criticalEventsOnly: z.boolean(),
        emailDigest: z.boolean(),
        weeklyDigest: z.boolean(),
        slackWebhookUrl: z.string().url().max(500).nullable(),
      })
      .partial(),
    appearance: z
      .object({
        theme: z.enum(['SYSTEM', 'LIGHT', 'DARK']),
        fontSize: z.enum(['SMALL', 'DEFAULT', 'LARGE']),
        sidebarDefault: z.enum(['EXPANDED', 'COLLAPSED']),
        secretMask: z.enum(['BULLETS', 'ASTERISKS', 'DASHES']),
        reduceMotion: z.boolean(),
      })
      .partial(),
    security: z
      .object({
        loginNotifications: z.boolean(),
        requireReauthForReveals: z.boolean(),
        sessionTimeoutMinutes: z.number().int().min(5).max(480).nullable(),
      })
      .partial(),
  })
  .partial()
  .refine((d) => Object.values(d).some((v) => v !== undefined && Object.keys(v).length > 0), {
    message: 'At least one preference must be provided',
  });
export type PreferencesInput = z.infer<typeof preferencesSchema>;

export const totpCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits') });
export const totpDisableSchema = z.object({ password: z.string().min(1) });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ListUsersInput = z.infer<typeof listUsersSchema>;
