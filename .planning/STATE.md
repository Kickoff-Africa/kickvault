# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-29)

**Core value:** Every credential is encrypted at rest, accessible only to authorised users, and every access is logged immutably — replacing zero accountability with total traceability.
**Current focus:** Phase 3 - User Management and RBAC

## Current Position

Phase: 3 of 8 (User Management and RBAC)
Plan: 1 of 3 in current phase
Status: In progress
Last activity: 2026-07-29 — Completed 03-01-PLAN.md (User management foundation)

Progress: [████░░░░░░] 42% (5/12 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 4 min
- Total execution time: 0.33 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-and-schema | 2/2 | 10 min | 5 min |
| 02-authentication | 2/2 | 7 min | 3.5 min |
| 03-user-management-and-rbac | 1/3 | 3 min | 3 min |

**Recent Trend:**
- Last 5 plans: 03-01 (3 min), 02-02 (4 min), 02-01 (3 min), 01-02 (3 min), 01-01 (7 min)
- Trend: Consistent

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 8-phase build order derived from research — Foundation, Auth, RBAC, ACLs, Credentials, Assets, Audit, Dashboard
- [Roadmap]: Phases 5 and 6 can execute in parallel (both depend on Phase 4, not each other)
- [Roadmap]: ACLs split into own phase (Phase 4) — per-resource permissions are complex enough to warrant dedicated focus
- [01-01]: Named import `{ pinoHttp }` required for Node16 module resolution (default import not callable for CJS packages)
- [01-01]: Prisma 7 schema removes url from datasource block; connection URL lives in prisma.config.ts
- [01-02]: Prisma 7 requires prisma.config.ts for datasource URL (url no longer in datasource block)
- [01-02]: AuditLog has no updatedAt -- immutability enforced at app and DB layer
- [02-01]: hashToken is the single SHA-256 hashing function for all opaque tokens — no direct crypto.createHash elsewhere
- [02-01]: Authenticate middleware uses fire-and-forget session lastActiveAt with 1-min threshold
- [02-01]: Argon2id uses reduced params in test env (memoryCost 1024 vs 19456)
- [02-01]: Email service uses setTransporter() for mock injection in tests
- [02-01]: prisma migrate diff requires --shadow-database-url; migration SQL written manually for simple ALTER TABLE
- [02-02]: Thin controller pattern — Zod parse + service call + response, no business logic in controllers
- [02-02]: Module structure convention: validation.ts -> service.ts -> controller.ts -> routes.ts
- [02-02]: Token rotation on refresh deletes old session and creates new (not update-in-place)
- [02-02]: describeWithDb guard pattern for database-dependent integration tests
- [03-01]: ForbiddenError on locked accounts carries no message -- prevents info disclosure
- [03-01]: SUPER_ADMIN always bypasses requireRole regardless of allowedRoles list

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-07-29T20:48:00Z
Stopped at: Completed 03-01-PLAN.md (User management foundation)
Resume file: None
