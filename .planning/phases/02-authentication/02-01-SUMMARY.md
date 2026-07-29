---
phase: 02-authentication
plan: 01
subsystem: auth
tags: [jwt, jose, argon2, nodemailer, express-middleware, prisma]

# Dependency graph
requires:
  - phase: 01-foundation-and-schema
    provides: Prisma schema with User/Session models, env config, error classes, logger
provides:
  - Token service with JWT sign/verify, refresh token generation, reset token hash pairs, generic hashToken
  - Password service with Argon2id hash/verify (env-aware options)
  - Email service with Nodemailer and mock injection support
  - Authenticate middleware extracting Bearer JWT and attaching req.user/sessionId
  - Express Request type augmentation (user, sessionId)
  - User model reset token fields (resetTokenHash, resetTokenExpiry)
affects: [02-02-auth-endpoints, 03-rbac, 04-acls]

# Tech tracking
tech-stack:
  added: [jose, "@node-rs/argon2", nodemailer, "@types/nodemailer"]
  patterns: [opaque-token-hashing-via-hashToken, env-aware-argon2-options, fire-and-forget-session-tracking, mock-injection-for-email]

key-files:
  created:
    - src/services/token.service.ts
    - src/services/password.service.ts
    - src/services/email.service.ts
    - src/middleware/authenticate.ts
    - src/types/express.d.ts
    - prisma/migrations/20260729100001_add_reset_token_fields/migration.sql
  modified:
    - prisma/schema.prisma
    - src/config/env.ts
    - vitest.config.ts
    - package.json

key-decisions:
  - "hashToken is the single SHA-256 hashing function for all opaque tokens (refresh + reset)"
  - "Authenticate middleware uses fire-and-forget session lastActiveAt update with 1-min threshold"
  - "Argon2id uses reduced params in test env for speed (memoryCost 1024 vs 19456)"
  - "Email service uses setTransporter for mock injection in tests"

patterns-established:
  - "Token hashing: always use hashToken() from token.service.ts, never crypto.createHash directly"
  - "Fire-and-forget DB writes: catch errors silently for non-critical updates"
  - "Env-aware options: check process.env.NODE_ENV for test vs production config"

# Metrics
duration: 3min
completed: 2026-07-29
---

# Phase 2 Plan 1: Auth Infrastructure Summary

**JWT token service with jose, Argon2id password hashing, email service with mock support, and Bearer token authenticate middleware**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-29T17:12:37Z
- **Completed:** 2026-07-29T17:15:28Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Token service: sign/verify JWT access tokens, generate refresh tokens, generate reset token pairs with SHA-256 hashing, export generic hashToken
- Password service: Argon2id hash and verify with env-aware options (fast in test, secure in production)
- Email service: Nodemailer transport with setTransporter mock injection for tests
- Authenticate middleware: Bearer token extraction, JWT verification, req.user/sessionId attachment, fire-and-forget session activity tracking
- Schema extended with resetTokenHash and resetTokenExpiry on User model
- Env config extended with JWT, session, SMTP, and frontend URL settings

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema migration, env config, and Express types** - `9e4efdd` (feat)
2. **Task 2: Core services and authenticate middleware** - `2924f7b` (feat)

## Files Created/Modified
- `src/services/token.service.ts` - JWT sign/verify, refresh token gen, reset token gen, hashToken
- `src/services/password.service.ts` - Argon2id hash/verify with env-aware options
- `src/services/email.service.ts` - Nodemailer transport with mock injection
- `src/middleware/authenticate.ts` - Bearer JWT verification, req.user/sessionId, session tracking
- `src/types/express.d.ts` - Express Request augmentation with user and sessionId
- `prisma/schema.prisma` - Added resetTokenHash and resetTokenExpiry to User
- `prisma/migrations/20260729100001_add_reset_token_fields/migration.sql` - ALTER TABLE for reset fields
- `src/config/env.ts` - Added JWT, session, SMTP, frontend URL env vars
- `vitest.config.ts` - Added JWT_SECRET, SMTP_FROM, FRONTEND_URL test env vars
- `package.json` - Added jose, @node-rs/argon2, nodemailer dependencies

## Decisions Made
- Used `hashToken` as the single SHA-256 hashing function for all opaque tokens — no direct crypto.createHash calls elsewhere
- Authenticate middleware uses fire-and-forget session lastActiveAt update with 1-minute threshold to avoid DB pressure
- Argon2id uses reduced parameters in test environment (memoryCost 1024, timeCost 1) for fast test execution
- Email service uses setTransporter() for mock injection rather than environment-based switching
- Migration SQL created manually (prisma migrate diff requires shadow database URL)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npx prisma migrate diff --from-migrations-dir` flag does not exist in Prisma 6; the correct flag is `--from-migrations`. Additionally, `--from-migrations` requires `--shadow-database-url`. Wrote migration SQL manually since the ALTER TABLE statements are straightforward.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All auth infrastructure services are in place for Plan 02-02 (auth endpoints)
- Token, password, and email services are independently testable
- Authenticate middleware ready to protect routes
- No blockers for next plan

---
*Phase: 02-authentication*
*Completed: 2026-07-29*
