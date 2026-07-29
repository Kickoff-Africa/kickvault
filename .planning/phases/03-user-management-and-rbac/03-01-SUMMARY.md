---
phase: 03-user-management-and-rbac
plan: 01
subsystem: auth
tags: [rbac, middleware, prisma, invite, email]

# Dependency graph
requires:
  - phase: 02-authentication
    provides: auth service, token service, email service, errors.ts, env config
provides:
  - requireRole middleware factory
  - ConflictError (409) class
  - generateInviteToken and generateTempPassword helpers
  - sendInviteEmail function
  - mustChangePassword, inviteTokenHash, inviteTokenExpiry schema fields
  - mustChangePassword flag in loginUser response
affects: [03-02, 03-03, 04-acl-system]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "requireRole middleware factory pattern for RBAC gating"
    - "SUPER_ADMIN bypass in role middleware"

key-files:
  created:
    - src/middleware/requireRole.ts
    - prisma/migrations/20260729200001_add_user_management_fields/migration.sql
  modified:
    - prisma/schema.prisma
    - src/lib/errors.ts
    - src/config/env.ts
    - vitest.config.ts
    - src/services/token.service.ts
    - src/services/email.service.ts
    - src/modules/auth/auth.service.ts

key-decisions:
  - "ForbiddenError on locked accounts carries no message to prevent info disclosure"
  - "SUPER_ADMIN always bypasses requireRole regardless of allowedRoles"

patterns-established:
  - "requireRole(...roles) middleware factory for route-level RBAC"
  - "ForbiddenError with no custom message for security-sensitive denials"

# Metrics
duration: 3min
completed: 2026-07-29
---

# Phase 3 Plan 1: User Management Foundation Summary

**Schema fields, ConflictError, invite token/email helpers, requireRole middleware, and mustChangePassword login flag**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-29T20:44:59Z
- **Completed:** 2026-07-29T20:48:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Added 3 new User model fields (mustChangePassword, inviteTokenHash, inviteTokenExpiry) with migration
- Created requireRole middleware factory with SUPER_ADMIN bypass
- Added ConflictError (409), generateInviteToken, generateTempPassword, sendInviteEmail
- Modified loginUser to return mustChangePassword flag

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema migration, ConflictError, env config, and token/email helpers** - `6b995b7` (feat)
2. **Task 2: requireRole middleware and loginUser mustChangePassword modification** - `d1aba19` (feat)

## Files Created/Modified
- `prisma/schema.prisma` - Added mustChangePassword, inviteTokenHash, inviteTokenExpiry to User model
- `prisma/migrations/20260729200001_add_user_management_fields/migration.sql` - Migration for 3 new columns
- `src/lib/errors.ts` - Added ConflictError (409)
- `src/config/env.ts` - Added INVITE_TOKEN_EXPIRY_DAYS (default 7)
- `vitest.config.ts` - Added INVITE_TOKEN_EXPIRY_DAYS to test env
- `src/services/token.service.ts` - Added generateInviteToken and generateTempPassword
- `src/services/email.service.ts` - Added sendInviteEmail with temp password and login URL
- `src/middleware/requireRole.ts` - Role-gating middleware factory
- `src/modules/auth/auth.service.ts` - Added mustChangePassword to login return, removed ForbiddenError message

## Decisions Made
- ForbiddenError on locked accounts carries no message -- prevents disclosing account lock status to attackers
- SUPER_ADMIN always bypasses requireRole regardless of allowedRoles list
- Prisma client regenerated after schema change (Rule 3 - blocking fix)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Regenerated Prisma client after schema change**
- **Found during:** Task 2 (requireRole middleware and loginUser modification)
- **Issue:** TypeScript compilation failed because Prisma client types were stale after adding new fields
- **Fix:** Ran `npx prisma generate` to regenerate client
- **Files modified:** node_modules/@prisma/client (generated)
- **Verification:** `npx tsc --noEmit` passes clean
- **Committed in:** d1aba19 (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Standard Prisma workflow requirement. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All foundation primitives ready for Plans 03-02 (invite/CRUD endpoints) and 03-03 (change password)
- requireRole middleware ready for route protection
- No blockers

---
*Phase: 03-user-management-and-rbac*
*Completed: 2026-07-29*
