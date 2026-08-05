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
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  ACCESS_TOKEN_EXPIRY_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_EXPIRY_DAYS: z.coerce.number().int().positive().default(7),
  INACTIVE_SESSION_TIMEOUT_MIN: z.coerce.number().int().positive().default(15),
  ACCOUNT_LOCKOUT_DURATION_MIN: z.coerce.number().int().positive().default(15),
  RESET_TOKEN_EXPIRY_MIN: z.coerce.number().int().positive().default(15),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().email().default('noreply@kickvault.local'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  INVITE_TOKEN_EXPIRY_DAYS: z.coerce.number().int().positive().default(7),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_NAME: z.string().default('Super Admin'),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
  ALLOWED_EMAIL_DOMAIN: z.string().optional(), // e.g. "kickoff.africa" — if set, only this domain can self-register
  REGISTRATION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'), // Default OFF — enable explicitly
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment:', result.error.format());
  process.exit(1);
}

export const env = result.data;
export type Env = typeof env;
