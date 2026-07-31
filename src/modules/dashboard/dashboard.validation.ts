import { z } from 'zod';

export const dashboardQuerySchema = z.object({
  expiring_threshold: z.coerce.number().int().min(1).max(365).default(30),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
