import { z } from 'zod';
import { PermissionLevel } from '@prisma/client';

export const grantAccessSchema = z.object({
  userId: z.string().min(1),
  permission: z.nativeEnum(PermissionLevel).default('VIEW'),
});

export type GrantAccessInput = z.infer<typeof grantAccessSchema>;
