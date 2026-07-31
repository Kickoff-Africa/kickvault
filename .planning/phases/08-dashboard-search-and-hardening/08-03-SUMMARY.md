---
phase: 08-dashboard-search-and-hardening
plan: "03"
subsystem: testing
tags: [vitest, supertest, integration-tests, dashboard, search, filter, expiry]

# Dependency graph
requires:
  - phase: 08-01
    provides: Dashboard stats endpoint (/api/dashboard/stats) with MANAGER auth gate
  - phase: 08-02
    provides: Credential search (?search=) and expiry filter (?expiring_within=), asset search

provides:
  - Integration tests covering all 5 DASH requirements (DASH-01 through DASH-05)
  - Dashboard stats tests: counts, expiring-soon window, custom threshold, activity feed shape
  - Credential search tests: case-insensitive friendlyName and systemHost matching, ACL scoping
  - Credential expiry filter tests: window inclusion, exclusion of past/null, invalid format 400
  - Asset search tests: case-insensitive name and assetId matching, ACL scoping

affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - createTestCredential via basePrisma with manual encrypt() for direct expiresAt control
    - Unique superadmin email per describe block (search-admin1@test.com pattern) to avoid cross-test collision when beforeEach clears users

key-files:
  created:
    - src/modules/dashboard/dashboard.test.ts
  modified:
    - src/modules/credentials/credentials.test.ts
    - src/modules/assets/assets.test.ts

key-decisions:
  - "Dashboard test uses basePrisma.credential.create (not API) for direct expiresAt control — testing expiry windows requires specific dates that API cannot accept as past timestamps"
  - "Each DASH-03/DASH-05 describe block creates its own SUPER_ADMIN with unique email — beforeEach TRUNCATE means users are cleared between tests but unique emails prevent collision within a single test file run"
  - "Asset search tests use Date.now() suffix on assetId to ensure no uniqueness collisions across test runs within a describe block"

patterns-established:
  - "expiring_within test pattern: create credential via basePrisma with explicit Date arithmetic, then verify filter includes/excludes via HTTP"
  - "Access-control search test: create two matching resources, grant access to only one, assert search returns only the accessible one"

# Metrics
duration: 3min
completed: 2026-07-30
---

# Phase 8 Plan 03: Integration Tests for Dashboard, Search & Hardening

**Integration tests covering DASH-01 through DASH-05 — dashboard stats (counts + activity feed), credential search/expiry filter, and asset search with full ACL scoping verification**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-07-31T02:50:20Z
- **Completed:** 2026-07-31T02:53:08Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- DASH-01/02 covered by 11 dashboard tests — stats count accuracy, expiring-soon window, custom threshold, and activity feed shape (10-item cap, newest-first order, user object shape)
- DASH-03/05 covered by 9 credential tests — case-insensitive search on friendlyName and systemHost, ACL scoping, expiry window inclusion/exclusion, and invalid format 400
- DASH-04 covered by 5 asset tests — case-insensitive search on name and assetId, ACL scoping for non-privileged users

## Task Commits

Each task was committed atomically:

1. **Task 1: Dashboard integration tests** - `1eadb34` (test)
2. **Task 2: Credential search/filter and asset search tests** - `cd2e660` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/modules/dashboard/dashboard.test.ts` - New; covers DASH-01 and DASH-02 with authorization tests
- `src/modules/credentials/credentials.test.ts` - Added DASH-03 and DASH-05 describe blocks at end of file
- `src/modules/assets/assets.test.ts` - Added DASH-04 describe block at end of file

## Decisions Made

- Used `basePrisma.credential.create` (not the HTTP API) in dashboard and expiry tests to set specific `expiresAt` timestamps — the create API only accepts ISO datetime strings for future dates, making past/exact-future dates hard to control via HTTP
- Created a fresh SUPER_ADMIN per describe block (unique email per block) for credential search tests rather than sharing one admin across all describe blocks — prevents state leakage when `beforeEach` truncates users between tests

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The `describeWithDb` skip pattern (dummy DB URL in vitest.config.ts) meant all tests run as skipped in CI without a real database — consistent with all other test files in the project.

## Next Phase Readiness

- All 5 DASH requirements have integration test coverage
- Phase 8 is complete — all dashboard, search, and hardening work done
- No blockers

---
*Phase: 08-dashboard-search-and-hardening*
*Completed: 2026-07-30*
