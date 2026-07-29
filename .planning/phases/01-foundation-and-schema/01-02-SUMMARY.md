---
phase: 01-foundation-and-schema
plan: 02
subsystem: database
tags: [prisma, postgresql, schema, orm, cuid]

# Dependency graph
requires:
  - phase: 01-foundation-and-schema/01
    provides: "Node.js project with TypeScript, Prisma dependency installed"
provides:
  - "Complete Prisma schema with 7 models and 4 enums"
  - "prisma.config.ts for Prisma 7 datasource configuration"
  - "Database foundation for all 8 phases"
affects: [02-authentication, 03-rbac, 04-acl-permissions, 05-credential-management, 06-asset-management, 07-audit-logging, 08-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CUID IDs for all models via @default(cuid())"
    - "snake_case column mapping via @map() on all fields"
    - "Soft-delete pattern via deletedAt field on Credential and Asset"
    - "Append-only AuditLog (no updatedAt)"
    - "ACL join tables with unique compound constraints"

key-files:
  created:
    - "prisma/schema.prisma"
    - "prisma.config.ts"
  modified: []

key-decisions:
  - "Prisma 7 requires prisma.config.ts for datasource URL configuration (url removed from datasource block)"
  - "AuditLog has no updatedAt -- immutability enforced at app and DB layer"
  - "User model includes failedAttempts and lockedUntil for brute-force protection"

patterns-established:
  - "CUID IDs: All models use String @id @default(cuid())"
  - "Column mapping: camelCase Prisma fields map to snake_case DB columns"
  - "Table mapping: All models use @@map() for snake_case table names"
  - "Soft-delete: deletedAt DateTime? with @@index for query performance"
  - "Append-only logs: AuditLog omits updatedAt, uses only createdAt"

# Metrics
duration: 3min
completed: 2026-07-29
---

# Phase 1 Plan 2: Prisma Schema Summary

**Complete Prisma schema with 7 models (User, Session, Credential, Asset, CredentialAccess, AssetAccess, AuditLog), 4 enums, CUID IDs, soft-delete, and append-only audit log**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-29T10:59:00Z
- **Completed:** 2026-07-29T11:02:32Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Complete Prisma schema covering all 6 model groups for all 8 phases
- All models use CUID IDs with snake_case column/table mapping
- Soft-delete on Credential and Asset via deletedAt field
- Append-only AuditLog with no updatedAt field
- ACL join tables (CredentialAccess, AssetAccess) with unique compound constraints
- Prisma 7 compatible with prisma.config.ts for datasource configuration

## Task Commits

Each task was committed atomically:

1. **Task 1: Create complete Prisma schema** - `53e1f2e` (feat)

## Files Created/Modified
- `prisma/schema.prisma` - Complete database schema with 7 models, 4 enums, relations, and indexes
- `prisma.config.ts` - Prisma 7 datasource configuration pointing to DATABASE_URL env var

## Decisions Made
- **Prisma 7 datasource config:** Prisma 7 no longer supports `url` in the `datasource` block. Created `prisma.config.ts` with migrate URL function to maintain DATABASE_URL env var pattern.
- **Schema follows plan exactly:** All models, fields, relations, and indexes match the plan specification.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Prisma 7 datasource URL configuration change**
- **Found during:** Task 1 (Schema validation)
- **Issue:** Prisma 7 removed support for `url` property in `datasource` block; `prisma validate` failed
- **Fix:** Removed `url` from datasource block, created `prisma.config.ts` with `migrate.url()` function
- **Files modified:** prisma/schema.prisma, prisma.config.ts
- **Verification:** `prisma validate` passes, `prisma format` produces no changes
- **Committed in:** 53e1f2e (part of task commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary adaptation to Prisma 7 API. No scope creep.

## Issues Encountered
None beyond the Prisma 7 datasource change documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema is complete and validated, ready for migration generation
- All models needed for phases 2-8 are defined
- Next plan (01-03) can proceed with any remaining foundation work

---
*Phase: 01-foundation-and-schema*
*Completed: 2026-07-29*
