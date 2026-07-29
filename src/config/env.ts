import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  MASTER_ENCRYPTION_KEY: z
    .string()
    .length(64, 'Must be 64 hex characters (256-bit key)')
    .regex(/^[0-9a-fA-F]{64}$/, 'Must be hex string'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment:', result.error.format());
  process.exit(1);
}

export const env = result.data;
export type Env = typeof env;
