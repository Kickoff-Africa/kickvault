# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-29)

**Core value:** Every credential is encrypted at rest, accessible only to authorised users, and every access is logged immutably — replacing zero accountability with total traceability.
**Current focus:** Phase 6 - Asset Management (complete)

## Current Position

Phase: 6 of 8 (Asset Management)
Plan: 1 of 1 in current phase
Status: Phase complete
Last activity: 2026-07-30 — Completed 06-01-PLAN.md (Asset CRUD with state machine)

Progress: [██████████] 100% (12/12 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 12
- Average duration: 3 min
- Total execution time: 0.60 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-and-schema | 2/2 | 10 min | 5 min |
| 02-authentication | 2/2 | 7 min | 3.5 min |
| 03-user-management-and-rbac | 3/3 | 9 min | 3 min |
| 04-per-resource-acls | 2/2 | 4 min | 2 min |
| 05-credential-vault | 2/2 | 6 min | 3 min |
| 06-asset-management | 1/1 | 2 min | 2 min |

**Recent Trend:**
- Last 5 plans: 06-01 (2 min), 05-02 (3 min), 05-01 (3 min), 04-02 (2 min), 04-01 (2 min)
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
- [03-02]: Route order: /me/password before /:id to prevent 'me' captured as param
- [03-02]: resendInvite guard checks mustChangePassword only (not inviteTokenExpiry)
- [03-02]: requireRole() with no args = SUPER_ADMIN only; requireRole('MANAGER') = SUPER_ADMIN + MANAGER
- [03-02]: Express 5 req.params returns string | string[] -- use `as string` cast for single-param routes
- [03-03]: Test helpers use auto-incrementing counter for unique emails across tests
- [03-03]: Real prisma.session.create used for session preservation tests (not mocked sessionId)
- [04-01]: Permission hierarchy VIEW(1) < EDIT(2) < MANAGE(3) for numeric level comparison
- [04-01]: Grant access uses upsert -- idempotent, updates permission if access already exists
- [04-01]: ForbiddenError() with no message in requireResourceAccess -- consistent with RBAC pattern
- [04-01]: Prisma P2025 error code caught on delete for clean not-found handling
- [04-02]: FK-safe cleanup order: delete access join tables before parent credential/asset tables
- [04-02]: Unique email prefixes per test file (creduser/assetuser) to avoid cross-file collision
- [05-01]: systemHost and username optional in Zod validation to match Prisma schema String? fields
- [05-01]: PermissionLevel enum imported from @prisma/client for type-safe ACL calls
- [05-01]: Prisma.InputJsonValue used for audit metadata type to match Prisma Json field
- [05-01]: credentialAccess relation name used in list where clause to match Prisma schema
- [05-02]: Create credentials via API for reveal tests to exercise full encrypt-decrypt path
- [05-02]: Rate limit test uses sequential requests for deterministic ordering
- [05-02]: auditLog.deleteMany() added to FK-safe cleanup order for tests with REVEAL
- [06-01]: assetAccess relation name used in listAssets where clause (matching Prisma schema)
- [06-01]: Status transition validation only runs when data.status is defined in update
- [06-01]: Audit logging on CREATE, UPDATE, and DELETE asset operations

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-07-30T15:52:18Z
Stopped at: Completed 06-01-PLAN.md (Asset CRUD with state machine)
Resume file: None
