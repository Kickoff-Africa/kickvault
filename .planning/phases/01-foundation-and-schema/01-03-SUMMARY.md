---
phase: 01-foundation-and-schema
plan: 03
subsystem: crypto,infra
tags: [aes-256-gcm, hkdf, vitest, docker, prisma, migrations, postgresql]

# Dependency graph
requires:
  - phase: 01-foundation-and-schema/01
    provides: "Express app scaffold, env config, TypeScript setup"
  - phase: 01-foundation-and-schema/02
    provides: "Complete Prisma schema"
provides:
  - "AES-256-GCM envelope encryption module with HKDF key derivation"
  - "7 passing unit tests for encryption"
  - "Multi-stage Dockerfile for Coolify deployment"
  - "docker-compose.yml with PostgreSQL 17 and health checks"
  - "scripts/start.sh — auto-runs migrations then starts server"
  - "Initial Prisma migration (all 7 models, 4 enums)"
  - "AuditLog immutability trigger (PostgreSQL BEFORE UPDATE OR DELETE)"
  - ".env.example documenting all required env vars"
affects: [05-credential-vault, 07-audit-logging]

# Tech tracking
tech-stack:
  added: [prisma@6 (downgraded from 7), docker, postgresql:17-alpine]
  patterns:
    - "TDD: write failing tests, then implement to green"
    - "Vitest env vars set in vitest.config.ts (not in test files) for ESM module evaluation order"
    - "Envelope encryption: HKDF-SHA256(masterKey, keyVersion) -> DEK -> AES-256-GCM per value"
    - "Docker multi-stage build: builder stage (compile) + runner stage (minimal prod image)"
    - "Prisma 6: standard url = env(DATABASE_URL) in schema.prisma, no config file needed"

key-files:
  created:
    - src/lib/crypto.ts
    - src/lib/crypto.test.ts
    - docker/Dockerfile
    - docker-compose.yml
    - scripts/start.sh
    - .env.example
    - prisma/migrations/20260729000001_init/migration.sql
    - prisma/migrations/20260729000002_audit_log_trigger/migration.sql
    - prisma/migrations/migration_lock.toml
  modified:
    - vitest.config.ts (added test.env for MASTER_ENCRYPTION_KEY and DATABASE_URL)
    - package.json (downgraded prisma to v6)
    - prisma/schema.prisma (restored url = env("DATABASE_URL"))

key-decisions:
  - "Downgraded Prisma 7 → 6: Prisma 7 requires explicit driver adapters (new PrismaClient() fails without one); Prisma 6 is standard and stable"
  - "Vitest env vars in config, not test file: ESM module hoisting means process.env assignments in test files run after module imports"
  - "Migration files created manually via prisma migrate diff (not migrate dev): local P1010 shadow DB issue avoided; deploy works correctly inside Docker"
  - "AuditLog trigger added as separate migration for clarity and independent testability"

patterns-established:
  - "Crypto API: encrypt(plaintext, keyVersion?) -> EncryptedData; decrypt(EncryptedData) -> string"
  - "Docker entrypoint: sh scripts/start.sh (prisma migrate deploy then node dist/server.js)"
  - "Test env: set DATABASE_URL and MASTER_ENCRYPTION_KEY in vitest.config.ts test.env"

# Metrics
duration: ~45min (including Prisma 7→6 downgrade)
completed: 2026-07-29
---

# Phase 1 Plan 3: Crypto Module + Docker Summary

**AES-256-GCM envelope encryption with 7 passing tests, and full Docker deployment with auto-migrations. All Phase 1 success criteria verified.**

## Performance

- **Duration:** ~45 min (including Prisma 7→6 downgrade)
- **Completed:** 2026-07-29
- **Tasks:** 2 (TDD crypto + Docker)
- **Files created:** 9

## Accomplishments

- Envelope encryption: HKDF-SHA256 per key version, random 12-byte IV per call, AES-256-GCM, auth tag verification
- All 7 unit tests pass (encrypt/decrypt, random IV, key versioning, tamper detection, empty string, unicode)
- Multi-stage Dockerfile using node:22-alpine — build stage compiles TypeScript, runner stage is minimal
- docker-compose.yml starts API + PostgreSQL 17 with health checks and dependency ordering
- scripts/start.sh runs `prisma migrate deploy` then `node dist/server.js` on every container start
- Initial migration applies all 7 models and 4 enums via clean SQL
- AuditLog immutability trigger: BEFORE UPDATE OR DELETE raises exception (verified working)

## All Phase 1 Success Criteria Met

| Criterion | Status |
|-----------|--------|
| GET /health returns 200 with uptime | ✓ Verified |
| GET /health/ready returns 200 with database connected | ✓ Verified |
| docker compose up starts API + PostgreSQL | ✓ Verified |
| Prisma migrations run automatically on startup | ✓ Verified (both migrations applied) |
| Same plaintext → different ciphertext each call | ✓ Verified by test |

## Task Commits

1. **Task 1: Crypto module (TDD)** — `729435d` (feat)
2. **Task 2: Docker + Prisma 6 + migrations** — `5d152b1` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Vitest env var timing in ESM**
- **Issue:** `process.env.MASTER_ENCRYPTION_KEY = ...` at top of test file ran AFTER module imports due to ESM hoisting
- **Fix:** Moved env vars to `vitest.config.ts` test.env section — loaded before any test modules

**2. [Rule 3 - Blocking] Prisma 7 requires driver adapter**
- **Issue:** Prisma 7's `new PrismaClient()` fails without an explicit driver adapter; breaking change from v6
- **Fix:** Downgraded to Prisma 6.19.3; removed prisma.config.ts; restored `url = env("DATABASE_URL")` in schema

**3. [Rule 3 - Blocking] Migration SQL had Prisma stdout in file**
- **Issue:** `prisma migrate diff ... > migration.sql` captured both stdout text and SQL
- **Fix:** Stripped the non-SQL header line from the migration file

**4. [Rule 3 - Blocking] Docker npm ci lockfile mismatch**
- **Issue:** `npm ci` failed in Docker (linux/arm64) because lockfile had macOS-specific packages
- **Fix:** Changed Dockerfile to `npm install` — resolves platform-specific deps correctly

---
*Phase: 01-foundation-and-schema*
*Completed: 2026-07-29*
