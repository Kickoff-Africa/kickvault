# Phase 8: Dashboard, Search & Hardening - Research

**Researched:** 2026-07-30
**Domain:** REST API aggregation endpoints, search/filter, performance
**Confidence:** HIGH

## Summary

This phase adds three capabilities to the existing KickVault API: (1) a dashboard stats endpoint aggregating counts and recent activity, (2) search/filter query parameters on existing credentials and assets list endpoints, and (3) performance validation. No new libraries are needed -- everything is achievable with Prisma's existing query API (count, aggregation, string filtering with `mode: 'insensitive'`).

The codebase already follows a clean module pattern (validation.ts -> service.ts -> controller.ts -> routes.ts) with Zod for input validation. Search/filter extends the existing `listCredentials` and `listAssets` service functions by adding optional query parameters. The dashboard is a new module (`src/modules/dashboard/`) following the same convention.

**Primary recommendation:** Extend existing list endpoints with query params for search/filter (DASH-03, DASH-04, DASH-05), create a new dashboard module for stats/activity feed (DASH-01, DASH-02), and add index-backed queries for performance (DASH-05).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Prisma Client | 6.19.3 | Database queries (count, findMany, ILIKE via `contains`) | Already in use, supports all needed operations |
| Zod | (existing) | Query parameter validation | Already in use for all validation |
| Express 5 | (existing) | Route handling, query params | Already in use |

### Supporting
No new libraries needed. All requirements are met by existing dependencies.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Prisma `contains` + `mode: 'insensitive'` | Raw SQL with `ILIKE` | Raw SQL is unnecessary; Prisma's `contains` with `mode: 'insensitive'` generates PostgreSQL ILIKE. Use Prisma for consistency. |
| In-memory aggregation | Prisma `count()` | Always use database-level `count()` for accuracy and performance |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/modules/
  dashboard/
    dashboard.service.ts     # Stats + activity feed queries
    dashboard.controller.ts  # Thin controller (parse + call + respond)
    dashboard.routes.ts      # GET /api/dashboard/stats
  credentials/
    credentials.validation.ts  # ADD: listCredentialsQuerySchema
    credentials.service.ts     # MODIFY: listCredentials to accept search/filter params
    credentials.controller.ts  # MODIFY: list() to parse query params
  assets/
    assets.validation.ts       # ADD: listAssetsQuerySchema
    assets.service.ts          # MODIFY: listAssets to accept search params
    assets.controller.ts       # MODIFY: list() to parse query params
```

### Pattern 1: Search via Query Parameters on Existing List Endpoints
**What:** Add optional `?search=` and `?expiring_within=` query params to GET /api/credentials and GET /api/assets
**When to use:** DASH-03, DASH-04, DASH-05

The existing `listCredentials(userId, userRole)` signature gets extended to accept a params object. The controller parses query params via Zod and passes them through.

**Example:**
```typescript
// credentials.validation.ts - ADD
export const listCredentialsQuerySchema = z.object({
  search: z.string().optional(),
  expiring_within: z.string().regex(/^\d+d$/).optional(),  // e.g. "30d"
});
export type ListCredentialsQuery = z.infer<typeof listCredentialsQuerySchema>;

// credentials.service.ts - MODIFY listCredentials
export async function listCredentials(
  userId: string,
  userRole: string,
  query?: ListCredentialsQuery,
) {
  const isPrivileged = userRole === 'SUPER_ADMIN' || userRole === 'MANAGER';
  const where: Prisma.CredentialWhereInput = {
    deletedAt: null,
    ...(!isPrivileged && { credentialAccess: { some: { userId } } }),
  };

  // DASH-03: Search by friendlyName or systemHost
  if (query?.search) {
    where.OR = [
      { friendlyName: { contains: query.search, mode: 'insensitive' } },
      { systemHost: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  // DASH-05: Filter by expiry window
  if (query?.expiring_within) {
    const days = parseInt(query.expiring_within.replace('d', ''), 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    where.expiresAt = { lte: cutoff, gte: new Date() };
  }

  return prisma.credential.findMany({
    where,
    select: SAFE_CREDENTIAL_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}
```

### Pattern 2: Dashboard Stats with Prisma Count
**What:** Single endpoint returning aggregated counts + recent activity
**When to use:** DASH-01, DASH-02

**Example:**
```typescript
// dashboard.service.ts
export async function getDashboardStats(expiringThresholdDays = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + expiringThresholdDays);

  const [totalAssets, totalCredentials, expiringCredentials, recentActivity] =
    await Promise.all([
      prisma.asset.count({ where: { deletedAt: null } }),
      prisma.credential.count({ where: { deletedAt: null } }),
      prisma.credential.count({
        where: {
          deletedAt: null,
          expiresAt: { lte: cutoff, gte: new Date() },
        },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
    ]);

  return { totalAssets, totalCredentials, expiringCredentials, recentActivity };
}
```

### Pattern 3: Asset Search
**What:** Add `?search=` query param to GET /api/assets for Name and Asset ID
**When to use:** DASH-04

**Example:**
```typescript
// assets.service.ts - MODIFY listAssets
if (query?.search) {
  where.OR = [
    { name: { contains: query.search, mode: 'insensitive' } },
    { assetId: { contains: query.search, mode: 'insensitive' } },
  ];
}
```

### Anti-Patterns to Avoid
- **Separate search endpoints:** Don't create `/api/credentials/search`. Add query params to the existing GET `/api/credentials` endpoint. The requirement says "extend existing."
- **Client-side filtering:** Never fetch all records and filter in JS. Always push filtering to the database.
- **N+1 queries in dashboard:** Use `Promise.all()` to run independent count queries in parallel, not sequential awaits.
- **Forgetting `deletedAt: null`:** All queries must exclude soft-deleted records.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Case-insensitive search | Manual `.toLowerCase()` comparisons | Prisma `contains` with `mode: 'insensitive'` | Maps directly to PostgreSQL ILIKE, uses indexes |
| Date arithmetic for expiry | Manual millisecond math | `Date` built-in `setDate(getDate() + days)` | Clear, correct, handles month boundaries |
| Query param parsing | Manual `parseInt(req.query.x)` | Zod schema with `z.coerce` | Consistent with project pattern, type-safe |

**Key insight:** Prisma's query API handles all the PostgreSQL-specific features (ILIKE, count, date comparisons) without raw SQL.

## Common Pitfalls

### Pitfall 1: Prisma `contains` Without `mode: 'insensitive'`
**What goes wrong:** Default `contains` is case-sensitive in PostgreSQL
**Why it happens:** Prisma defaults to case-sensitive matching
**How to avoid:** Always include `mode: 'insensitive'` when using `contains` for search
**Warning signs:** Tests pass with exact case but fail with mixed case

### Pitfall 2: Expiring-Soon Count Including Already-Expired
**What goes wrong:** "Expiring soon" count includes credentials that have already expired
**Why it happens:** Only checking `expiresAt <= cutoff` without lower bound
**How to avoid:** Use `expiresAt: { lte: cutoff, gte: new Date() }` to get only future-expiring
**Warning signs:** Count seems too high, includes stale expired credentials

### Pitfall 3: Search Breaking Access Control
**What goes wrong:** Search bypasses the existing role-based where clause
**Why it happens:** Replacing the where clause instead of merging with it
**How to avoid:** Build the access-control where clause first, then add search conditions with AND semantics (Prisma merges top-level properties by AND)
**Warning signs:** Members can see credentials they don't have access to via search

### Pitfall 4: OR Conditions Conflicting with AND Access Control
**What goes wrong:** Prisma treats top-level `OR` as part of the overall AND, but if placed incorrectly it can widen the result set
**Why it happens:** Merging `OR` search with access-control conditions incorrectly
**How to avoid:** Structure the where clause so access-control filters are at the top level and the `OR` search is also top-level (Prisma ANDs all top-level properties together). Alternatively wrap the OR in an explicit AND array.
**Warning signs:** Search returns records the user shouldn't have access to

### Pitfall 5: Dashboard Endpoint Authorization
**What goes wrong:** Any authenticated user can see total counts across the organization
**Why it happens:** Not restricting dashboard to appropriate roles
**How to avoid:** Dashboard stats should likely be restricted to MANAGER+ since they expose organization-wide counts. Use `requireRole('MANAGER')`.
**Warning signs:** Members can see total credential/asset counts for the org

### Pitfall 6: Missing Database Indexes for Search
**What goes wrong:** ILIKE queries on `friendly_name` and `system_host` do full table scans
**Why it happens:** No index on these columns; ILIKE with leading wildcard defeats B-tree indexes anyway
**How to avoid:** For `contains` (which becomes `ILIKE '%term%'`), B-tree indexes won't help. For small-to-medium datasets (< 100K rows), this is fine. For larger datasets, consider `pg_trgm` extension with GIN indexes. Given KickVault is a credential/asset manager (likely < 10K records), standard queries will be well within the 500ms target.
**Warning signs:** Search queries exceeding 500ms on larger datasets

## Code Examples

### Dashboard Stats Endpoint (Full Flow)
```typescript
// dashboard.service.ts
import { prisma } from '../../config/database.js';

export async function getDashboardStats(thresholdDays = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + thresholdDays);
  const now = new Date();

  const [totalAssets, totalCredentials, expiringCredentials, recentActivity] =
    await Promise.all([
      prisma.asset.count({ where: { deletedAt: null } }),
      prisma.credential.count({ where: { deletedAt: null } }),
      prisma.credential.count({
        where: { deletedAt: null, expiresAt: { lte: cutoff, gte: now } },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      }),
    ]);

  return { totalAssets, totalCredentials, expiringCredentials, recentActivity };
}

// dashboard.controller.ts
import type { Request, Response } from 'express';
import { getDashboardStats } from './dashboard.service.js';

export async function stats(req: Request, res: Response): Promise<void> {
  const thresholdDays = req.query.expiring_threshold
    ? parseInt(req.query.expiring_threshold as string, 10)
    : 30;
  const result = await getDashboardStats(thresholdDays);
  res.json(result);
}

// dashboard.routes.ts
import { Router } from 'express';
import * as dashboardController from './dashboard.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();
router.get('/api/dashboard/stats', authenticate, requireRole('MANAGER'), dashboardController.stats);
export { router as dashboardRoutes };
```

### Credential Search Query Params (Zod Schema)
```typescript
// credentials.validation.ts - ADD
export const listCredentialsQuerySchema = z.object({
  search: z.string().max(255).optional(),
  expiring_within: z.string().regex(/^\d+d$/, 'Must be in format like "30d"').optional(),
});
export type ListCredentialsQuery = z.infer<typeof listCredentialsQuerySchema>;
```

### Asset Search Query Params (Zod Schema)
```typescript
// assets.validation.ts - ADD
export const listAssetsQuerySchema = z.object({
  search: z.string().max(255).optional(),
});
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;
```

### Wiring Dashboard into app.ts
```typescript
// app.ts - ADD
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
// ...
app.use(dashboardRoutes);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw SQL for ILIKE | Prisma `contains` + `mode: 'insensitive'` | Prisma 2.x+ | No raw SQL needed for case-insensitive search |
| Separate count queries | `Promise.all()` with Prisma `count()` | Always valid | Parallel execution, cleaner code |

**Deprecated/outdated:**
- None relevant. Prisma 6.x supports all needed features.

## Key Implementation Details

### Prisma `contains` Maps to ILIKE
Prisma's `contains` with `mode: 'insensitive'` on PostgreSQL generates:
```sql
WHERE "friendly_name" ILIKE '%search_term%'
```
This is exactly what the requirements specify (DASH-03, DASH-04).

### Existing Indexes That Help
From the Prisma schema, these indexes already exist:
- `@@index([expiresAt])` on Credential - helps DASH-05 expiry filtering
- `@@index([createdAt])` on AuditLog - helps DASH-02 recent activity sort
- `@@index([assetId])` on Asset - helps DASH-04 asset ID search (exact match, not ILIKE)
- `@@index([deletedAt])` on Credential and Asset - helps all soft-delete filters

### No New Indexes Needed
For the expected data volume of a credential/asset management tool, the existing indexes are sufficient. ILIKE with leading wildcards (`%term%`) cannot use B-tree indexes regardless, but full table scans on < 10K rows complete in < 1ms.

### Dashboard Validation Schema
```typescript
// dashboard.validation.ts (optional, for strictness)
export const dashboardQuerySchema = z.object({
  expiring_threshold: z.coerce.number().int().min(1).max(365).default(30),
});
```

### Access Control for Dashboard
The requirement doesn't specify who can access dashboard stats. Recommendation: restrict to MANAGER+ since it exposes organization-wide counts. This follows the pattern of audit-logs being MANAGER+ restricted.

### Response Shape
```json
// GET /api/dashboard/stats
{
  "totalAssets": 42,
  "totalCredentials": 156,
  "expiringCredentials": 7,
  "recentActivity": [
    {
      "id": "...",
      "action": "CREATE",
      "targetType": "CREDENTIAL",
      "targetId": "...",
      "createdAt": "2026-07-30T...",
      "user": { "id": "...", "email": "...", "name": "..." }
    }
  ]
}
```

## Open Questions

1. **Dashboard access control level**
   - What we know: The requirement doesn't specify who can access dashboard stats
   - What's unclear: Should MEMBER/VIEWER see their own stats or org-wide stats?
   - Recommendation: MANAGER+ only (org-wide stats). Follows audit-logs precedent. If per-user stats are needed later, add a separate endpoint.

2. **Expiring-within: include already-expired or not?**
   - What we know: DASH-05 says "filter by expiry window" with `?expiring_within=30d`
   - What's unclear: Should this include already-expired credentials or only future-expiring?
   - Recommendation: Only future-expiring (expiresAt >= now AND <= cutoff). The dashboard "expiring soon" count (DASH-01) should also use this logic.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: credentials, assets, audit-logs modules (service, controller, routes, validation patterns)
- Prisma schema: `prisma/schema.prisma` (all models, indexes, relations)
- Prisma 6.x Client API: `contains`, `mode: 'insensitive'`, `count()` are stable, well-documented features

### Secondary (MEDIUM confidence)
- Prisma documentation on string filtering: `contains` with `mode: 'insensitive'` maps to PostgreSQL ILIKE (verified in Prisma docs)
- PostgreSQL ILIKE behavior with B-tree indexes: leading wildcard prevents index use (standard PostgreSQL behavior)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed, all existing tools support requirements
- Architecture: HIGH - Direct extension of established module pattern in codebase
- Pitfalls: HIGH - Based on direct codebase analysis and known Prisma/PostgreSQL behavior

**Research date:** 2026-07-30
**Valid until:** 2026-08-30 (stable domain, no fast-moving dependencies)
