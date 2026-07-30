---
phase: 04-per-resource-acls
verified: 2026-07-29T00:00:00Z
status: gaps_found
score: 14/16 must-haves verified
gaps:
  - truth: "MEMBER and VIEWER receive 403 on all grant/revoke/list ACL management endpoints"
    status: partial
    reason: "requireRole('MANAGER') is applied to all three routes so the behavior is correct, but tests only assert 403 for MEMBER and VIEWER on the grant endpoint — revoke and list 403 behavior for these roles is untested"
    artifacts:
      - path: "src/modules/credential-access/credential-access.test.ts"
        issue: "Tests MEMBER/VIEWER 403 on POST only; no test for DELETE or GET with restricted roles"
      - path: "src/modules/asset-access/asset-access.test.ts"
        issue: "Tests MEMBER/VIEWER 403 on POST only; no test for DELETE or GET with restricted roles"
    missing:
      - "Test: MEMBER receives 403 on DELETE /api/credentials/:id/access/:userId"
      - "Test: MEMBER receives 403 on GET /api/credentials/:id/access"
      - "Test: VIEWER receives 403 on DELETE /api/credentials/:id/access/:userId"
      - "Test: VIEWER receives 403 on GET /api/credentials/:id/access"
      - "Test: MEMBER receives 403 on DELETE /api/assets/:id/access/:userId"
      - "Test: MEMBER receives 403 on GET /api/assets/:id/access"
      - "Test: VIEWER receives 403 on DELETE /api/assets/:id/access/:userId"
      - "Test: VIEWER receives 403 on GET /api/assets/:id/access"
  - truth: "Granting access to a non-existent or inactive user returns 404"
    status: partial
    reason: "Service correctly checks isActive: true in the user lookup, but no test exercises the inactive-user path — only the non-existent-user path is tested"
    artifacts:
      - path: "src/modules/credential-access/credential-access.test.ts"
        issue: "No test for granting access to an inactive (isActive=false) user"
      - path: "src/modules/asset-access/asset-access.test.ts"
        issue: "No test for granting access to an inactive (isActive=false) user"
    missing:
      - "Test: grant access to an inactive user on credential endpoint returns 404"
      - "Test: grant access to an inactive user on asset endpoint returns 404"
human_verification:
  - test: "checkCredentialAccess / checkAssetAccess end-to-end enforcement"
    expected: "A MEMBER with no ACL entry is denied access; a MEMBER with a VIEW entry can read; a MEMBER with only VIEW is denied EDIT operations"
    why_human: "No credential/asset CRUD endpoints exist yet (Phases 5/6); helpers are implemented and structurally correct but cannot be exercised end-to-end until those routes are built"
---

# Phase 4: Per-Resource ACLs Verification Report

**Phase Goal:** Every credential and asset has an explicit access list — users can only access resources they have been specifically granted permission to
**Verified:** 2026-07-29
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SUPER_ADMIN or MANAGER can grant VIEW/EDIT/MANAGE access to a credential via POST /api/credentials/:id/access | VERIFIED | Route exists with requireRole('MANAGER'); SUPER_ADMIN bypass via hardcoded check in requireRole.ts; controller calls grantCredentialAccess returning 201 |
| 2 | SUPER_ADMIN or MANAGER can revoke a credential access entry via DELETE /api/credentials/:id/access/:userId | VERIFIED | Route wired with requireRole('MANAGER'); service performs prisma.credentialAccess.delete and throws NotFoundError on P2025; controller returns 204 |
| 3 | SUPER_ADMIN or MANAGER can list all users with access to a credential via GET /api/credentials/:id/access | VERIFIED | Route wired; service includes user.email and user.name via Prisma include; controller returns 200 |
| 4 | SUPER_ADMIN or MANAGER can grant, revoke, and list access on assets via mirrored /api/assets/:assetId/access endpoints | VERIFIED | All three asset-access routes exist, are wired in app.ts, and mirror the credential-access pattern exactly |
| 5 | MEMBER and VIEWER receive 403 on all grant/revoke/list ACL management endpoints | PARTIAL | requireRole('MANAGER') is on all 6 routes so runtime behavior is correct; tests only cover the grant (POST) endpoint for MEMBER and VIEWER, leaving revoke and list 403 paths untested |
| 6 | checkCredentialAccess and checkAssetAccess helpers exist for Phases 5/6 | VERIFIED | requireResourceAccess.ts exports both functions with SUPER_ADMIN/MANAGER bypass, ACL lookup, and permission-hierarchy comparison |
| 7 | Grant endpoint returns 201 with access record containing userId, credentialId/assetId, and permission | VERIFIED | Controller returns res.status(201).json({ access }); service returns the upserted record with all three fields; test asserts all three properties |
| 8 | Granting again with different permission updates it (upsert idempotent) returns 201 | VERIFIED | Service uses prisma.credentialAccess.upsert / prisma.assetAccess.upsert; test verifies single row exists and permission updated |
| 9 | List endpoint returns 200 with access entries that include user email and name | VERIFIED | Service includes { user: { select: { id, email, name } } }; test asserts entry.user.email and entry.user.name |
| 10 | Revoke endpoint returns 204 and the access entry is deleted | VERIFIED | Controller returns 204; test verifies DB count drops to 0 |
| 11 | MEMBER receives 403 on grant, revoke, and list endpoints | PARTIAL | Grant (POST) tested and passing; revoke/list 403 for MEMBER not tested (see gap 1) |
| 12 | VIEWER receives 403 on grant, revoke, and list endpoints | PARTIAL | Grant (POST) tested and passing; revoke/list 403 for VIEWER not tested (see gap 1) |
| 13 | Granting access to a non-existent credential/asset returns 404 | VERIFIED | Service checks credential/asset existence first; test asserts 404 for 'nonexistent-id' on both modules |
| 14 | Granting access to a non-existent or inactive user returns 404 | PARTIAL | Service checks { deletedAt: null, isActive: true }; non-existent user test exists; inactive user path has no test (see gap 2) |
| 15 | Revoking a non-existent access entry returns 404 | VERIFIED | Service catches Prisma P2025 and rethrows as NotFoundError; test asserts 404 |
| 16 | Listing access on a non-existent credential/asset returns 404 | VERIFIED | Service checks resource existence before findMany; test asserts 404 for 'nonexistent-id' on both modules |

**Score:** 14/16 truths verified (2 partial due to missing test coverage)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/modules/credential-access/credential-access.validation.ts` | grantAccessSchema with userId + permission | VERIFIED | Exports grantAccessSchema; PermissionLevel enum; defaults to VIEW; 9 lines |
| `src/modules/credential-access/credential-access.service.ts` | grantCredentialAccess, revokeCredentialAccess, listCredentialAccess | VERIFIED | All three functions present; 69 lines; real Prisma queries; no stubs |
| `src/modules/credential-access/credential-access.routes.ts` | 3 routes with requireRole('MANAGER') | VERIFIED | POST/DELETE/GET wired; all use authenticate + requireRole('MANAGER') |
| `src/modules/asset-access/asset-access.service.ts` | grantAssetAccess, revokeAssetAccess, listAssetAccess | VERIFIED | All three functions present; 69 lines; mirrors credential pattern |
| `src/modules/asset-access/asset-access.routes.ts` | 3 routes with requireRole('MANAGER') | VERIFIED | POST/DELETE/GET wired; all use authenticate + requireRole('MANAGER') |
| `src/middleware/requireResourceAccess.ts` | checkCredentialAccess, checkAssetAccess with SUPER_ADMIN/MANAGER bypass | VERIFIED | Both functions exported; bypass on lines 17/37; permission hierarchy enforced; 47 lines |
| `src/app.ts` | credentialAccessRoutes and assetAccessRoutes wired | VERIFIED | Both imported and app.use'd at lines 9-10, 22-23 |
| `src/modules/credential-access/credential-access.test.ts` | 12 test cases | VERIFIED | Exactly 12 it() blocks; covers grant, upsert, list, revoke, 403, 404 scenarios |
| `src/modules/asset-access/asset-access.test.ts` | 12 test cases | VERIFIED | Exactly 12 it() blocks; mirrors credential test structure |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| credential-access.routes.ts | credential-access.controller.ts | import * | WIRED | Controller imported and all 3 handlers registered |
| asset-access.routes.ts | asset-access.controller.ts | import * | WIRED | Controller imported and all 3 handlers registered |
| credential-access.controller.ts | credential-access.service.ts | named imports | WIRED | grantCredentialAccess/revoke/list all imported and called |
| asset-access.controller.ts | asset-access.service.ts | named imports | WIRED | grantAssetAccess/revoke/list all imported and called |
| credential-access.service.ts | prisma.credentialAccess | Prisma client | WIRED | upsert, delete, findMany all present with real where clauses |
| asset-access.service.ts | prisma.assetAccess | Prisma client | WIRED | upsert, delete, findMany all present with real where clauses |
| requireResourceAccess.ts | prisma.credentialAccess / prisma.assetAccess | Prisma client | WIRED | findUnique calls present; result drives ForbiddenError |
| app.ts | credentialAccessRoutes + assetAccessRoutes | app.use | WIRED | Both mounted at lines 22-23 |
| routes | authenticate middleware | Express middleware chain | WIRED | authenticate called before requireRole on all 6 routes |
| routes | requireRole('MANAGER') | Express middleware chain | WIRED | Applied to all POST/DELETE/GET on both route files |

---

### Anti-Patterns Found

None detected. No TODO/FIXME/placeholder comments or empty return stubs in any implementation file.

---

### Human Verification Required

#### 1. checkCredentialAccess / checkAssetAccess end-to-end enforcement

**Test:** Once Phase 5/6 credential and asset CRUD endpoints exist, authenticate as a MEMBER with no ACL entry, attempt to read a credential/asset, and verify 403. Then grant VIEW access to that MEMBER and retry — expect 200.
**Expected:** 403 without ACL entry; 200 with VIEW entry; 403 if access level is insufficient (e.g., VIEW entry but EDIT required)
**Why human:** No credential or asset CRUD endpoints exist yet. The helper functions are implemented and structurally correct but cannot be exercised end-to-end until Phases 5 and 6 wire them into route middleware.

---

### Gaps Summary

Two gaps were found, both concerning test coverage rather than implementation correctness.

**Gap 1 — Incomplete role-denial test coverage on revoke and list routes.** The `requireRole('MANAGER')` middleware is applied to all three routes in both modules, so runtime behavior is correct for MEMBER and VIEWER on revoke and list. However, the test suite only asserts 403 for the grant (POST) endpoint. Eight tests are missing: MEMBER and VIEWER denied on DELETE and GET for both credential-access and asset-access.

**Gap 2 — Inactive user 404 path not tested.** The service correctly queries `{ deletedAt: null, isActive: true }`, so an inactive user will return 404 at runtime. A test for granting access to a user created with `isActive: false` does not exist in either test file. The plan required "non-existent or inactive user returns 404" to be verified.

Both gaps are test coverage gaps. The production code is correctly implemented. Adding the missing tests will satisfy these must-haves.

---

_Verified: 2026-07-29_
_Verifier: Claude (gsd-verifier)_
