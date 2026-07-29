# Phase 1: Foundation & Schema - Research

**Researched:** 2026-07-29
**Domain:** Express + TypeScript project scaffolding, Prisma schema design, Docker deployment, AES-256-GCM envelope encryption
**Confidence:** HIGH

## Summary

Phase 1 establishes the entire project foundation: a TypeScript + Express 5 server with Zod-validated environment config, Pino structured logging, a complete Prisma schema covering all 6 model groups (for all 8 phases), Docker deployment with automatic migrations, health check endpoints for Coolify, and an envelope encryption module using HKDF + AES-256-GCM.

The standard approach is well-established: Express 5 with native promise support, Prisma ORM with `@default(cuid())` IDs, multi-stage Docker builds, and Node.js built-in `node:crypto` for encryption. All libraries in the stack are mature and current.

**Primary recommendation:** Build the entire Prisma schema for all phases upfront (all 6 model groups) so migrations are stable from day one. Deliver the encryption module with full test coverage since it is the security foundation for everything that follows.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^5.1 | HTTP framework | Native promise support in v5, most widely deployed Node.js framework |
| @prisma/client | ^6.x | Database ORM client | Type-safe queries, auto-generated types from schema |
| prisma (CLI) | ^6.x | Migrations, schema management | `prisma migrate deploy` is idempotent, safe for Docker startup |
| typescript | ^5.8 | Type system | Current stable release |
| zod | ^3.24 | Validation + env parsing | TypeScript-first, infers types from schemas. Note: Zod 4 exists but is very new; Zod 3 is battle-tested and recommended for production |
| pino | ^10.3 | Structured JSON logging | 4-5x faster than Winston, structured JSON by default |
| pino-http | ^10 | Express request logging | Auto-logs request/response with timing |
| dotenv | ^16 | .env file loading | Standard for local development |
| node:crypto | built-in | AES-256-GCM + HKDF | Zero dependencies, OpenSSL-backed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino-pretty | ^13 | Human-readable logs | Dev only (`NODE_ENV !== 'production'`) |
| tsx | ^4 | TypeScript execution | Dev server with watch mode |
| vitest | ^4.1 | Test runner | Unit tests for crypto module |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zod 3 | Zod 4 | Zod 4 is newer/faster but less battle-tested; Zod 3 has massive ecosystem support |
| dotenv + zod | @t3-oss/env-core | Adds a dependency for ~30 lines of code |
| pino | winston | Winston is slower, heavier; pino is the performance choice |

### Installation

```bash
# Production
npm install express @prisma/client pino pino-http dotenv zod helmet cors

# Dev
npm install -D typescript prisma vitest tsx pino-pretty @types/express @types/cors @types/node
```

## Architecture Patterns

### Recommended Project Structure
```
kickvault/
  src/
    server.ts                  # HTTP listener, graceful shutdown
    app.ts                     # Express app setup, global middleware, route mounting
    config/
      env.ts                   # Zod-validated environment variables (singleton)
      database.ts              # PrismaClient singleton
    middleware/
      errorHandler.ts          # Global error handler (sanitizes errors in production)
      validate.ts              # Zod schema validation wrapper for req.body/params/query
    modules/
      health/
        health.routes.ts       # GET /health, GET /health/ready
    lib/
      crypto.ts                # AES-256-GCM encrypt/decrypt + HKDF key derivation
      logger.ts                # Pino instance creation
      errors.ts                # Custom error classes (AppError, NotFoundError, etc.)
    types/
      express.d.ts             # Augment Express Request with user context (for later phases)
  prisma/
    schema.prisma              # Complete schema for all 8 phases
    migrations/                # Migration history (auto-generated + custom SQL for trigger)
  scripts/
    start.sh                   # Docker entrypoint: migrate + start
  docker/
    Dockerfile                 # Multi-stage build
    docker-compose.yml         # App + PostgreSQL for local dev
    .env.example               # Template for required env vars
  vitest.config.ts             # Vitest configuration
  tsconfig.json                # TypeScript configuration
  package.json
```

### Pattern 1: Zod Environment Validation (fail-fast at startup)

**What:** Parse and validate all environment variables at application startup using Zod. Export a typed `env` object. Never read `process.env` directly elsewhere.
**When to use:** Always. This is the single most important pattern for preventing runtime config errors.

```typescript
// src/config/env.ts
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  MASTER_ENCRYPTION_KEY: z
    .string()
    .length(64, 'Must be 64 hex characters (256-bit key)')
    .regex(/^[0-9a-fA-F]+$/, 'Must be hexadecimal'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
```

### Pattern 2: PrismaClient Singleton

**What:** Single PrismaClient instance stored on `globalThis` to survive dev hot-reloading.
**When to use:** Always. Multiple PrismaClient instances exhaust connection pools.
**Source:** [Prisma official docs](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections)

```typescript
// src/config/database.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

### Pattern 3: Pino Logger with Express Middleware

**What:** Create a Pino logger instance, use pino-http as Express middleware for automatic request logging.
**When to use:** All routes. Mount early in middleware chain.

```typescript
// src/lib/logger.ts
import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty' },
  }),
});

// src/app.ts
import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from './lib/logger.js';

const app = express();
app.use(pinoHttp({ logger }));
app.use(express.json());
// ... mount routes
export { app };
```

### Pattern 4: Express 5 Error Handler

**What:** Express 5 natively catches rejected promises from async handlers. Use a global error handler middleware (4-arg signature) to format all errors consistently.
**When to use:** Mount as the LAST middleware.

```typescript
// src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public isOperational = true,
  ) {
    super(message);
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message = err instanceof AppError ? err.message : 'Internal Server Error';

  logger.error({ err, path: req.path, method: req.method }, message);

  res.status(statusCode).json({
    error: { message, statusCode },
  });
}
```

### Pattern 5: Health Check Endpoints

**What:** Two endpoints: `/health` for liveness (is the process alive?) and `/health/ready` for readiness (can it serve requests, is DB connected?).
**When to use:** Required by Coolify. Must be unauthenticated.

```typescript
// src/modules/health/health.routes.ts
import { Router } from 'express';
import { prisma } from '../../config/database.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

router.get('/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: 'not_ready',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});

export { router as healthRoutes };
```

### Pattern 6: Graceful Shutdown

**What:** Listen for SIGTERM/SIGINT, close HTTP server and Prisma connections before exiting.
**When to use:** Always. Docker sends SIGTERM on container stop.

```typescript
// src/server.ts
import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { logger } from './lib/logger.js';

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Server started');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down gracefully');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

### Anti-Patterns to Avoid
- **Reading `process.env` directly:** Always use the validated `env` object from `config/env.ts`.
- **Multiple PrismaClient instances:** Always use the singleton from `config/database.ts`.
- **Logging secrets:** Never log `MASTER_ENCRYPTION_KEY`, credential plaintext, or password hashes. Configure Pino redaction if needed.
- **IV reuse in AES-GCM:** A reused IV under the same key completely breaks GCM security. Always generate a fresh random IV per encryption.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Environment validation | Manual `if (!process.env.X)` checks | Zod schema parse at startup | Catches all missing/malformed vars at once, provides types |
| Request logging | Custom `console.log` middleware | pino-http | Structured JSON, response timing, request IDs |
| Security headers | Manual `res.setHeader()` calls | helmet | 13+ headers, maintained against new attack vectors |
| CORS handling | Manual `Access-Control-*` headers | cors package | Handles preflight, credentials, origin matching |
| ID generation | `uuid()` or sequential IDs | Prisma `@default(cuid())` | Non-sequential (prevents enumeration), shorter than UUID |
| Crypto primitives | Custom encrypt/decrypt wrappers around WebCrypto | `node:crypto` createCipheriv/createDecipheriv | Battle-tested OpenSSL bindings, GCM auth tags built in |

**Key insight:** The foundation phase is tempting to over-engineer. Resist adding middleware, patterns, or libraries that aren't needed until Phase 2+. Build exactly what the success criteria require.

## Common Pitfalls

### Pitfall 1: AES-GCM Nonce Reuse
**What goes wrong:** Reusing an IV (nonce) with the same key in AES-GCM mode allows an attacker to recover the XOR of two plaintexts and forge authentication tags, completely breaking both confidentiality and integrity.
**Why it happens:** Developers store a fixed IV or derive it deterministically from the plaintext.
**How to avoid:** Always call `crypto.randomBytes(12)` for every single encryption operation. Store the IV alongside the ciphertext. The 96-bit (12-byte) random nonce is safe for up to ~2^32 encryptions under one DEK before birthday collision risk becomes concerning.
**Warning signs:** Same ciphertext output for the same plaintext input. If your tests show deterministic output, the IV is being reused.

### Pitfall 2: Prisma Generate Not Run Before Build
**What goes wrong:** TypeScript compilation fails with "cannot find module '@prisma/client'" errors because the generated client types don't exist.
**Why it happens:** `prisma generate` is forgotten in the build pipeline or Dockerfile.
**How to avoid:** Always run `npx prisma generate` before `npm run build` in the Dockerfile build stage. Include it in the `build` script: `"build": "prisma generate && tsc"`.
**Warning signs:** TypeScript errors about missing Prisma types during CI/Docker build.

### Pitfall 3: Missing Prisma Directory in Docker Production Stage
**What goes wrong:** `prisma migrate deploy` fails at container startup because the `prisma/` directory (with `schema.prisma` and `migrations/`) wasn't copied to the production stage.
**Why it happens:** Multi-stage Docker builds only copy what you explicitly `COPY --from=builder`.
**How to avoid:** Add `COPY --from=builder /app/prisma ./prisma` to the runner stage.
**Warning signs:** Container crashes on startup with "Could not find prisma schema" or "Could not find migrations directory".

### Pitfall 4: Auth Tag Handling in AES-GCM
**What goes wrong:** Decryption fails silently or throws "Unsupported state or unable to authenticate data" because the auth tag is not properly extracted or set.
**Why it happens:** The GCM auth tag must be retrieved via `cipher.getAuthTag()` after `cipher.final()` and stored. On decryption, it must be set via `decipher.setAuthTag(tag)` before calling `decipher.update()`.
**How to avoid:** Follow the exact order: encrypt -> final() -> getAuthTag() -> store. Decrypt -> setAuthTag() -> update() -> final().
**Warning signs:** Decryption always fails even with correct key and IV.

### Pitfall 5: Express 5 Type Conflicts
**What goes wrong:** TypeScript errors when using `@types/express` v5 because the types changed for route parameters, request generics, etc.
**Why it happens:** Express 5 changed internal typing for better promise support.
**How to avoid:** Use `@types/express@^5` which matches Express 5. Avoid using the v4 types package.
**Warning signs:** Type errors on route handlers, especially around async handlers and error middleware.

### Pitfall 6: Docker Compose DATABASE_URL Hostname
**What goes wrong:** App container can't connect to PostgreSQL because `DATABASE_URL` uses `localhost` instead of the Docker service name.
**Why it happens:** `localhost` inside a container refers to the container itself, not the host or other containers.
**How to avoid:** In `docker-compose.yml`, the PostgreSQL service name (e.g., `db`) IS the hostname. Use `DATABASE_URL=postgresql://user:pass@db:5432/kickvault`.
**Warning signs:** "Connection refused" errors on container startup.

## Code Examples

### Envelope Encryption with HKDF + AES-256-GCM

```typescript
// src/lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;       // 96-bit nonce for GCM
const TAG_LENGTH = 16;      // 128-bit auth tag
const KEY_LENGTH = 32;      // 256-bit key
const HKDF_HASH = 'sha256';
const HKDF_SALT = Buffer.alloc(32, 0); // Fixed salt (key versioning provides domain separation)
const HKDF_INFO_PREFIX = 'kickvault-dek-v';

/**
 * Derive a Data Encryption Key from the master key + key version using HKDF-SHA256.
 * Each key version produces a unique, deterministic DEK.
 */
function deriveDEK(keyVersion: number): Buffer {
  const masterKey = Buffer.from(env.MASTER_ENCRYPTION_KEY, 'hex');
  const info = `${HKDF_INFO_PREFIX}${keyVersion}`;
  const derived = hkdfSync(HKDF_HASH, masterKey, HKDF_SALT, info, KEY_LENGTH);
  return Buffer.from(derived);
}

export interface EncryptedData {
  encryptedValue: string; // base64
  iv: string;             // base64
  authTag: string;        // base64
  keyVersion: number;
}

/**
 * Encrypt plaintext using AES-256-GCM with a DEK derived from the master key.
 * Generates a unique random IV per call -- same plaintext produces different ciphertext.
 */
export function encrypt(plaintext: string, keyVersion: number = 1): EncryptedData {
  const dek = deriveDEK(keyVersion);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, dek, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    encryptedValue: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyVersion,
  };
}

/**
 * Decrypt ciphertext using AES-256-GCM with the DEK for the stored key version.
 * Verifies integrity via the GCM auth tag -- throws if tampered.
 */
export function decrypt(data: EncryptedData): string {
  const dek = deriveDEK(data.keyVersion);
  const iv = Buffer.from(data.iv, 'base64');
  const authTag = Buffer.from(data.authTag, 'base64');
  const encryptedValue = Buffer.from(data.encryptedValue, 'base64');

  const decipher = createDecipheriv(ALGORITHM, dek, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedValue),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
```

### Complete Prisma Schema (All 6 Model Groups)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Enums ─────────────────────────────────────────────

enum Role {
  SUPER_ADMIN
  MANAGER
  MEMBER
  VIEWER
}

enum AssetCategory {
  HARDWARE
  SOFTWARE
  DIGITAL
  INTANGIBLE
}

enum AssetStatus {
  ACTIVE
  MAINTENANCE
  RETIRED
  LOST
}

enum PermissionLevel {
  VIEW
  EDIT
  MANAGE
}

// ─── User ──────────────────────────────────────────────

model User {
  id               String    @id @default(cuid())
  email            String    @unique
  name             String
  passwordHash     String    @map("password_hash")
  role             Role      @default(MEMBER)
  isActive         Boolean   @default(true) @map("is_active")
  failedAttempts   Int       @default(0) @map("failed_attempts")
  lockedUntil      DateTime? @map("locked_until")
  lastLoginAt      DateTime? @map("last_login_at")
  deletedAt        DateTime? @map("deleted_at")
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  sessions           Session[]
  credentials        Credential[]      @relation("CredentialCreator")
  assets             Asset[]           @relation("AssetCreator")
  credentialAccess   CredentialAccess[]
  assetAccess        AssetAccess[]
  auditLogs          AuditLog[]

  @@map("users")
}

// ─── Session (DB-backed for revocation) ────────────────

model Session {
  id           String   @id @default(cuid())
  userId       String   @map("user_id")
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshToken String   @unique @map("refresh_token")
  userAgent    String?  @map("user_agent")
  ipAddress    String?  @map("ip_address")
  expiresAt    DateTime @map("expires_at")
  lastActiveAt DateTime @default(now()) @map("last_active_at")
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@index([expiresAt])
  @@map("sessions")
}

// ─── Credential (encrypted vault entry) ────────────────

model Credential {
  id             String    @id @default(cuid())
  friendlyName   String    @map("friendly_name")
  systemHost     String?   @map("system_host")
  username       String?
  encryptedValue String    @map("encrypted_value")
  iv             String
  authTag        String    @map("auth_tag")
  keyVersion     Int       @default(1) @map("key_version")
  expiresAt      DateTime? @map("expires_at")
  deletedAt      DateTime? @map("deleted_at")
  createdById    String    @map("created_by_id")
  createdBy      User      @relation("CredentialCreator", fields: [createdById], references: [id])
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  access CredentialAccess[]

  @@index([createdById])
  @@index([expiresAt])
  @@index([deletedAt])
  @@map("credentials")
}

// ─── Asset ─────────────────────────────────────────────

model Asset {
  id          String        @id @default(cuid())
  assetId     String        @unique @map("asset_id")
  name        String
  category    AssetCategory
  status      AssetStatus   @default(ACTIVE)
  location    String?
  notes       String?
  deletedAt   DateTime?     @map("deleted_at")
  createdById String        @map("created_by_id")
  createdBy   User          @relation("AssetCreator", fields: [createdById], references: [id])
  createdAt   DateTime      @default(now()) @map("created_at")
  updatedAt   DateTime      @updatedAt @map("updated_at")

  access AssetAccess[]

  @@index([assetId])
  @@index([category])
  @@index([status])
  @@index([deletedAt])
  @@map("assets")
}

// ─── Per-Resource ACL Join Tables ──────────────────────

model CredentialAccess {
  id           String          @id @default(cuid())
  userId       String          @map("user_id")
  user         User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  credentialId String          @map("credential_id")
  credential   Credential      @relation(fields: [credentialId], references: [id], onDelete: Cascade)
  permission   PermissionLevel @default(VIEW)
  grantedAt    DateTime        @default(now()) @map("granted_at")

  @@unique([userId, credentialId])
  @@index([credentialId])
  @@map("credential_access")
}

model AssetAccess {
  id         String          @id @default(cuid())
  userId     String          @map("user_id")
  user       User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  assetId    String          @map("asset_id")
  asset      Asset           @relation(fields: [assetId], references: [id], onDelete: Cascade)
  permission PermissionLevel @default(VIEW)
  grantedAt  DateTime        @default(now()) @map("granted_at")

  @@unique([userId, assetId])
  @@index([assetId])
  @@map("asset_access")
}

// ─── AuditLog (append-only, immutable) ─────────────────

model AuditLog {
  id         String   @id @default(cuid())
  action     String                          // e.g. "credential.revealed", "user.login_failed"
  targetType String   @map("target_type")    // e.g. "credential", "asset", "user"
  targetId   String?  @map("target_id")
  userId     String   @map("user_id")
  user       User     @relation(fields: [userId], references: [id])
  ipAddress  String?  @map("ip_address")
  userAgent  String?  @map("user_agent")
  metadata   Json?                           // Additional context (field changes, reason, etc.)
  createdAt  DateTime @default(now()) @map("created_at")
  // NO updatedAt -- append-only by design

  @@index([userId])
  @@index([targetType, targetId])
  @@index([action])
  @@index([createdAt])
  @@map("audit_logs")
}
```

### PostgreSQL Trigger for AuditLog Immutability

This SQL must be added to a Prisma migration using `npx prisma migrate dev --create-only`:

```sql
-- Prevent any UPDATE or DELETE on the audit_logs table.
-- This is defense-in-depth: even if application code or direct SQL tries to
-- mutate audit records, the database itself will reject the operation.

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs table is append-only: % operations are forbidden', TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();

-- Additionally, revoke DELETE and UPDATE from the application database user.
-- Replace 'kickvault_app' with the actual database user your app connects as.
-- REVOKE UPDATE, DELETE ON audit_logs FROM kickvault_app;
```

**Note on REVOKE:** The `REVOKE` statement is commented out because in most Docker/Coolify setups, the application connects as the database owner. To use REVOKE, you would need a separate migration user (with full DDL privileges) and an application user (with restricted DML). The trigger alone provides strong immutability enforcement. Consider adding REVOKE as a production hardening step in Phase 8.

### Docker Setup

**Multi-stage Dockerfile:**

```dockerfile
# ── Build stage ──────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ── Production stage ─────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Copy only what's needed for production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts

RUN chmod +x scripts/start.sh

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["sh", "scripts/start.sh"]
```

**Entrypoint script:**

```bash
#!/bin/sh
# scripts/start.sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting server..."
node dist/server.js
```

**docker-compose.yml:**

```yaml
services:
  api:
    build:
      context: .
      dockerfile: docker/Dockerfile
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://kickvault:kickvault@db:5432/kickvault
      MASTER_ENCRYPTION_KEY: ${MASTER_ENCRYPTION_KEY:-0000000000000000000000000000000000000000000000000000000000000000}
      NODE_ENV: development
      LOG_LEVEL: debug
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: kickvault
      POSTGRES_PASSWORD: kickvault
      POSTGRES_DB: kickvault
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kickvault"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

### TypeScript Configuration

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### package.json Scripts

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "prisma generate && tsc",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push",
    "db:studio": "prisma studio",
    "lint": "tsc --noEmit"
  }
}
```

### Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/**'],
    },
  },
});
```

### Crypto Module Unit Tests

```typescript
// src/lib/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './crypto.js';

describe('Envelope Encryption (HKDF + AES-256-GCM)', () => {
  const testPlaintext = 'super-secret-api-key-12345';

  it('should encrypt and decrypt a value correctly', () => {
    const encrypted = encrypt(testPlaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(testPlaintext);
  });

  it('should produce different ciphertext for the same plaintext (random IV)', () => {
    const encrypted1 = encrypt(testPlaintext);
    const encrypted2 = encrypt(testPlaintext);
    expect(encrypted1.encryptedValue).not.toBe(encrypted2.encryptedValue);
    expect(encrypted1.iv).not.toBe(encrypted2.iv);
  });

  it('should produce different ciphertext with different key versions', () => {
    const v1 = encrypt(testPlaintext, 1);
    const v2 = encrypt(testPlaintext, 2);
    expect(v1.encryptedValue).not.toBe(v2.encryptedValue);
    // Both should decrypt correctly
    expect(decrypt(v1)).toBe(testPlaintext);
    expect(decrypt(v2)).toBe(testPlaintext);
  });

  it('should fail decryption with tampered ciphertext', () => {
    const encrypted = encrypt(testPlaintext);
    encrypted.encryptedValue = Buffer.from('tampered').toString('base64');
    expect(() => decrypt(encrypted)).toThrow();
  });

  it('should fail decryption with wrong key version', () => {
    const encrypted = encrypt(testPlaintext, 1);
    encrypted.keyVersion = 99;
    expect(() => decrypt(encrypted)).toThrow();
  });

  it('should handle empty string', () => {
    const encrypted = encrypt('');
    expect(decrypt(encrypted)).toBe('');
  });

  it('should handle unicode and special characters', () => {
    const unicode = 'P@$$w0rd! with unicode: cafe\u0301 \u{1F512}';
    const encrypted = encrypt(unicode);
    expect(decrypt(encrypted)).toBe(unicode);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express 4 + try-catch wrappers | Express 5 native async error handling | Express 5.0 (Oct 2024) | No need for `express-async-errors` or manual try-catch in every handler |
| jsonwebtoken (sync) | jose (Web Crypto, ESM) | jose v4+ (2022+) | Better security, ESM support, JWE/JWKS built in |
| bcrypt | @node-rs/argon2 (Argon2id) | OWASP recommendation (2023+) | Memory-hard, GPU-resistant, NIST recommended |
| Jest + ts-jest | Vitest | Vitest v1.0 (Dec 2023) | Native TS/ESM, 2-10x faster, zero config for TypeScript |
| UUID v4 | CUID | Prisma default | Non-sequential, shorter, prevents enumeration |
| Manual env checks | Zod schema validation | Community pattern (2022+) | Type-safe, fail-fast, single source of truth |

**Deprecated/outdated:**
- `crypto-js`: Deprecated since v4.2.0, use `node:crypto` instead
- `express-async-errors`: Unnecessary with Express 5's native promise handling
- `jsonwebtoken`: Still works but `jose` is the modern replacement with better security

## Open Questions

1. **Zod 3 vs Zod 4**
   - What we know: Zod 4 was released (current npm tag) with performance improvements. Zod 3 has massive ecosystem adoption.
   - What's unclear: Whether all ecosystem tooling (Prisma integration, etc.) fully supports Zod 4 yet.
   - Recommendation: Use Zod 3 (`zod@^3.24`) for stability. The API is virtually identical for env validation use cases. Migrate to Zod 4 later if desired.

2. **REVOKE on audit_logs table**
   - What we know: The PostgreSQL trigger prevents mutations. REVOKE on the app user would add defense-in-depth.
   - What's unclear: Whether Coolify/Docker PostgreSQL setups easily support separate migration vs. app database users.
   - Recommendation: Ship with the trigger only in Phase 1. Add REVOKE as part of Phase 8 production hardening if a separate DB user is configured.

3. **Express 5 @types/express compatibility**
   - What we know: Express 5 is released and stable. `@types/express@^5` exists.
   - What's unclear: Whether all type definitions for v5 are fully polished (especially for error middleware 4-arg signature).
   - Recommendation: Use `@types/express@^5`. If type issues arise with error handlers, use explicit type annotations on the middleware function signature.

## Sources

### Primary (HIGH confidence)
- [Prisma ORM: Models documentation](https://www.prisma.io/docs/orm/prisma-schema/data-model/models) - Schema syntax, enums, @@map, @default(cuid())
- [Prisma: PrismaClient singleton pattern](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections) - globalThis pattern for hot reloading
- [Prisma: Customizing migrations](https://www.prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations) - `--create-only` flag for custom SQL triggers
- [Express 5 migration guide](https://expressjs.com/en/guide/migrating-5/) - Breaking changes, native promise handling

### Secondary (MEDIUM confidence)
- [Vitest setup for Node.js + TypeScript](https://qaskills.sh/blog/vitest-config-setup-guide-2026) - Config patterns, globals, environment
- [Zod env validation patterns](https://dev.to/_877737de2d34ff8c6265/optimizing-connection-pools-with-prismaclient-singleton-pattern-in-nextjs-3emf) - Multiple community sources agree on the safeParse + process.exit pattern
- [pino-http Express middleware](https://deepwiki.com/pinojs/pino-http) - Integration API
- [AES-256-GCM in Node.js](https://gist.github.com/rjz/15baffeab434b8125ca4d783f4116d81) - Community reference implementation
- [PostgreSQL immutable audit triggers](https://gist.github.com/drbobbeaty/1c4a513e14fdb1e4e123ff9443f978c4) - BEFORE UPDATE/DELETE trigger pattern

### Tertiary (LOW confidence)
- Express 5 + TypeScript 5.8 type compatibility - Based on training data; no issues reported in searches but verify during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries are well-established, versions verified against npm/docs
- Architecture: HIGH - Patterns verified against official Prisma docs, Express docs, and established community patterns
- Prisma schema: HIGH - All model groups defined per project requirements with verified Prisma syntax
- Encryption module: HIGH - `node:crypto` HKDF + AES-256-GCM is well-documented; code verified against Node.js crypto API
- Docker setup: HIGH - Multi-stage pattern verified against Prisma Docker deployment docs
- Pitfalls: MEDIUM - Based on common issues documented across multiple sources

**Research date:** 2026-07-29
**Valid until:** 2026-08-28 (stable stack, low churn)
