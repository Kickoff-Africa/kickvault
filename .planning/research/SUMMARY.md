# Research Summary: Kick Vault

## Stack Decisions

| Layer | Choice | Avoid |
|-------|--------|-------|
| JWT | `jose@^6.2` — JWE/JWKS support, key rotation | `jsonwebtoken` — no JWE, legacy API |
| Password hashing | `@node-rs/argon2@^2.0` (Argon2id) — OWASP/NIST recommended | `bcrypt` — 72-byte limit, GPU-vulnerable |
| Encryption | `node:crypto` built-in — AES-256-GCM, zero deps | `crypto-js` — deprecated |
| Validation | `zod@^4.4` — TypeScript-first, also handles env config | `joi` — runtime-only types |
| Logging | `pino@^10.3` — structured JSON, 4-5x faster than Winston | `winston` — slow, verbose config |
| Testing | `vitest@^4.1` + `supertest@^7` — native TS/ESM | `jest` — slow TS transform config |
| Defer | Redis, BullMQ, OpenAPI docs — not MVP-blocking | — |

## Architecture Blueprint

**Module-based folder structure:**
```
src/
  modules/
    auth/          # login, session, lockout
    credentials/   # CRUD, reveal, encryption
    assets/        # CRUD, categories, status
    users/         # user management, role assignment
    audit/         # read-only log API
  middleware/      # authenticate, authorize, validate
  lib/             # crypto, prisma singleton, config
```

**DB schema critical decisions:**
- `Credential` stores `encryptedValue + iv + authTag + keyVersion` as separate columns
- `AuditLog` has no `updatedAt` — enforced append-only via PostgreSQL trigger
- CUID IDs on all models (non-sequential, prevents enumeration)
- Soft delete (`deletedAt DateTime?`) from day one

**Encryption pattern:** `HKDF-SHA256(masterKey, keyVersion)` → DEK → AES-256-GCM per credential. Master key never touches the DB.

**Middleware order per request:** `authenticate` → `authorize(permission)` → `validate(zodSchema)` → controller → service → auditLog

**Credential reveal flow:** `POST /credentials/:id/reveal` — audit log written BEFORE decryption, plaintext wiped from memory after response.

## Feature Gaps vs PRD

10 items missing from the PRD that must be addressed:

1. **Credential type schemas** — Need structured types (Login, API Key, SSH Key, Certificate, Database, Secure Note) with a `type` enum; affects DB schema from day 1
2. **Expiry threshold definitions** — "Expiring soon" needs concrete thresholds: 60d (info), 30d (warning), 7d (critical). Requires `expiresAt` field on credentials
3. **Secure reveal as POST** — Must be `POST /credentials/:id/reveal` (not GET), rate-limited (10/min/user), with optional `reason` field
4. **Resource-level permissions** — Org-wide RBAC vs per-asset ACLs must be decided before the DB schema is finalized ⚠️ product decision required
5. **Soft delete** — Hard vs soft delete affects FK integrity in audit logs; recommend soft delete with `deletedAt`
6. **Force logout / session revocation** — Admin must be able to revoke all sessions for a user (critical for offboarding)
7. **Search and filtering** — `?search=aws&type=API_KEY&status=ACTIVE` — PostgreSQL ILIKE is sufficient for 10K records
8. **Cursor-based pagination on audit logs** — Offset pagination degrades at ~3.65M rows/year
9. **Health check endpoints** — `GET /health` (liveness) and `GET /health/ready` (DB connectivity) — required by Coolify
10. **Global rate limiting** — PRD only covers login lockout; need 100 req/min global + 10 reveals/min per user

## Critical Pitfalls to Avoid

All 5 must be addressed in Phase 1, not post-MVP:

1. **IV reuse in AES-256-GCM** — Generate `crypto.randomBytes(12)` per encryption call, store IV as separate column, test that same plaintext produces different ciphertext on each call
2. **Master encryption key loss** — Coolify env var is a single point of failure; document offline key backup (physical or Shamir's Secret Sharing), test key restoration before any production data
3. **Plaintext leaking into logs** — Disable Prisma query logging in production; create `SensitiveValue` branded type whose `toJSON()` returns `[REDACTED]`; strip sensitive fields from global error handler
4. **Horizontal privilege escalation** — RBAC confirms role but not ownership; every credential/asset fetch must scope to resources the user can access; write explicit cross-user access tests
5. **Audit log bypass** — Route-handler-only logging is bypassable; use Prisma `$use` middleware + PostgreSQL trigger; revoke `DELETE`/`UPDATE` on `audit_logs` at DB-user level

## Build Order Recommendation

| Phase | Name | Key Deliverable |
|-------|------|----------------|
| 1 | Foundation | TypeScript config, Prisma schema (all models), migrations, crypto module, Docker, health checks, PostgreSQL audit lock |
| 2 | Authentication | Argon2id, jose JWTs, DB-backed sessions, login/logout/refresh, account lockout |
| 3 | RBAC | Role/permission seeding, `authorize()` middleware, user management, force-logout |
| 4 | Credential CRUD + Reveal | Encrypt-on-write, mask-on-read, rate-limited reveal, credential types, expiry tracking |
| 5 | Asset Management | Asset CRUD, categories, status state machine |
| 6 | Audit Log API | Cursor-paginated read-only API, composite indexes, Prisma `$use` middleware |
| 7 | Dashboard + Search | Aggregation stats, ILIKE search, expiry filters |
| 8 | Hardening | Rate limiting, body limits, graceful shutdown, key rotation endpoint, CORS, OpenAPI docs |

**Confidence:** HIGH across all areas — benchmarked against Bitwarden, HashiCorp Vault, 1Password API patterns.

---
*Research completed: 2026-07-29*
