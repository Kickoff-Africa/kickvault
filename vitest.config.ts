import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
      MASTER_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      JWT_SECRET: 'test-jwt-secret-must-be-at-least-32-characters-long',
      SMTP_FROM: 'test@kickvault.local',
      FRONTEND_URL: 'http://localhost:3000',
      INVITE_TOKEN_EXPIRY_DAYS: '7',
    },
  },
});
