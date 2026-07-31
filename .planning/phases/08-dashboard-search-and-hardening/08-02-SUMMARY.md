---
phase: 08-dashboard-search-and-hardening
plan: 02
subsystem: api
tags: [prisma, zod, search, filter, credentials, assets, typescript]

# Dependency graph
requires:
  - phase: 05-credential-vault
    provides: listCredentials service and credentials controller
  - phase: 06-asset-management
    provides: listAssets service and assets controller
provides:
  - Credential list endpoint accepts ?search= (friendlyName, systemHost) and ?expiring_within=Nd
  - Asset list endpoint accepts ?search= (name, assetId)
  - Case-insensitive Prisma contains search with mode insensitive
  - Access control preserved via top-level Prisma where ANDing with OR search conditions
affects: [08-03-hardening, future dashboard frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - parseQuery helper mirrors parseBody — same ZodError to ValidationError transform applied to req.query
    - Mutable Prisma.ModelWhereInput pattern — build base where, append OR search and date filters conditionally
    - Top-level Prisma where properties AND automatically — place access filter and OR search at same level

key-files:
  created: []
  modified:
    - src/modules/credentials/credentials.validation.ts
    - src/modules/credentials/credentials.service.ts
    - src/modules/credentials/credentials.controller.ts
    - src/modules/assets/assets.validation.ts
    - src/modules/assets/assets.service.ts
    - src/modules/assets/assets.controller.ts

key-decisions:
  - "parseQuery helper added to both controllers (same ZodError -> ValidationError transform as parseBody)"
  - "Prisma.CredentialWhereInput / Prisma.AssetWhereInput typed where object allows conditional OR appending"
  - "Access control filter stays top-level (ANDed by Prisma) — OR search does not wrap or break the access filter"
  - "expiring_within parsed as Nd string, converted to int days, cutoff date built from Date.setDate"

patterns-established:
  - "parseQuery<T>: generic query param parser matching parseBody pattern"
  - "Mutable typed where object: build base, append OR/date filters only when query params present"

# Metrics
duration: 4min
completed: 2026-07-30
---

# Phase 8 Plan 02: Search and Filter for Credentials and Assets Summary

**Case-insensitive search on credentials (friendlyName, systemHost) and assets (name, assetId) plus credential expiry window filter, all preserving existing access control via Prisma top-level where ANDing**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-31T02:46:01Z
- **Completed:** 2026-07-31T02:50:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Credentials list accepts `?search=` filtering on friendlyName and systemHost (case-insensitive) and `?expiring_within=Nd` filtering to credentials expiring within N days
- Assets list accepts `?search=` filtering on name and assetId (case-insensitive)
- Both endpoints remain backward compatible — omitting query params returns all results as before
- Access control preserved — privileged users see all, non-privileged users see only accessible resources, regardless of search

## Task Commits

Each task was committed atomically:

1. **Task 1: Add search/filter to credentials module** - `ef91480` (feat)
2. **Task 2: Add search to assets module** - `1aae2a8` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/modules/credentials/credentials.validation.ts` - Added listCredentialsQuerySchema with search and expiring_within
- `src/modules/credentials/credentials.service.ts` - listCredentials accepts optional query; mutable Prisma.CredentialWhereInput with conditional OR and date range
- `src/modules/credentials/credentials.controller.ts` - parseQuery helper + updated list function to parse and forward query
- `src/modules/assets/assets.validation.ts` - Added listAssetsQuerySchema with search
- `src/modules/assets/assets.service.ts` - listAssets accepts optional query; mutable Prisma.AssetWhereInput with conditional OR
- `src/modules/assets/assets.controller.ts` - parseQuery helper + updated list function to parse and forward query

## Decisions Made
- `parseQuery` helper added to both controllers using the same ZodError-to-ValidationError transform as the existing `parseBody` helper — consistent with pattern established in audit-logs controller (07-03)
- Used `Prisma.CredentialWhereInput` / `Prisma.AssetWhereInput` typed mutable where objects to allow safe conditional appending of OR search and date filter conditions
- Access control filter remains at the top level of the where object so Prisma ANDs it with all other conditions (including the OR search block) automatically — no explicit AND wrapper needed
- `expiring_within` format validated as `/^\d+d$/` regex — value parsed to int days, cutoff date computed via `Date.setDate`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DASH-03, DASH-04, DASH-05 search/filter requirements fulfilled
- Ready for 08-03 hardening phase
- No blockers

---
*Phase: 08-dashboard-search-and-hardening*
*Completed: 2026-07-30*
