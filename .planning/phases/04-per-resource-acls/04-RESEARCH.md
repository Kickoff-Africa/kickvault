# Phase 4: Per-Resource ACLs - Research

**Researched:** 2026-07-29
**Domain:** Authorization / Access Control Lists (resource-level permissions)
**Confidence:** HIGH

## Summary

Phase 4 builds the ACL management layer -- endpoints for granting and revoking per-resource permissions, plus a reusable middleware/helper for checking access that Phases 5 and 6 will consume. The schema is already complete: `CredentialAccess` and `AssetAccess` join tables with `PermissionLevel` enum (VIEW, EDIT, MANAGE) exist in the database with proper unique constraints and indexes.

This phase does NOT build credential or asset CRUD -- it only builds: (1) grant/revoke endpoints for credential access, (2) grant/revoke endpoints for asset access, (3) a `requireResourceAccess` helper that later phases will call to enforce ACL checks, and (4) a helper to list the access list for a given resource.

**Primary recommendation:** Follow the established module pattern (validation.ts -> service.ts -> controller.ts -> routes.ts) with two modules: `src/modules/credential-access/` and `src/modules/asset-access/`. Extract the shared ACL-checking logic into `src/middleware/requireResourceAccess.ts` so Phases 5 and 6 can import it directly.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Prisma Client | 7.x (already installed) | Query CredentialAccess/AssetAccess tables | Already the project ORM |
| Zod | 3.x (already installed) | Validate grant/revoke request bodies | Already the project validator |
| Express 5 | 5.x (already installed) | Route definitions | Already the project framework |

### Supporting
No new libraries are required. This phase is pure application logic using existing dependencies.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom ACL middleware | CASL.js | CASL adds attribute-based authorization but is overkill for explicit join-table ACLs. The schema already encodes access as simple rows -- a lightweight helper function is sufficient |
| Per-route ACL checks | Prisma middleware | Prisma middleware runs on every query globally, making it hard to distinguish "check access" from "admin listing." Per-route is more explicit and fits the existing pattern |

## Architecture Patterns

### Recommended Project Structure
```
src/
  modules/
    credential-access/    # ACL-01, ACL-03
      validation.ts       # Zod schemas for grant/revoke
      service.ts          # grant, revoke, listAccess, checkAccess
      controller.ts       # Thin controllers
      routes.ts           # POST grant, DELETE revoke, GET list
    asset-access/         # ACL-02, ACL-04
      validation.ts
      service.ts
      controller.ts
      routes.ts
  middleware/
    requireResourceAccess.ts  # Reusable ACL check for Phases 5 & 6
```

### Pattern 1: Grant/Revoke as Upsert/Delete

**What:** Grant uses Prisma `upsert` to create or update permission level. Revoke uses `delete` on the unique constraint.
**When to use:** Every grant/revoke operation.
**Example:**
```typescript
// Grant: upsert on the unique [userId, credentialId] constraint
export async function grantCredentialAccess(
  credentialId: string,
  userId: string,
  permission: PermissionLevel,
) {
  // Verify credential exists and is not soft-deleted
  const credential = await prisma.credential.findFirst({
    where: { id: credentialId, deletedAt: null },
  });
  if (!credential) throw new NotFoundError('Credential not found');

  // Verify target user exists and is active
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
  });
  if (!user) throw new NotFoundError('User not found');

  return prisma.credentialAccess.upsert({
    where: {
      userId_credentialId: { userId, credentialId },
    },
    create: { userId, credentialId, permission },
    update: { permission },
  });
}

// Revoke: delete the ACL row
export async function revokeCredentialAccess(
  credentialId: string,
  userId: string,
) {
  const existing = await prisma.credentialAccess.findUnique({
    where: {
      userId_credentialId: { userId, credentialId },
    },
  });
  if (!existing) throw new NotFoundError('Access entry not found');

  return prisma.credentialAccess.delete({
    where: { id: existing.id },
  });
}
```

### Pattern 2: Reusable ACL Check Helper (for Phases 5 & 6)

**What:** A function (not middleware) that checks if a user has the required permission level on a resource. SUPER_ADMIN and MANAGER bypass the check.
**When to use:** Inside service functions in Phases 5 and 6 when accessing/modifying a credential or asset.
**Example:**
```typescript
// src/middleware/requireResourceAccess.ts
import { prisma } from '../config/database.js';
import { ForbiddenError } from '../lib/errors.js';
import type { PermissionLevel, Role } from '@prisma/client';

const PERMISSION_HIERARCHY: Record<PermissionLevel, number> = {
  VIEW: 1,
  EDIT: 2,
  MANAGE: 3,
};

export async function checkCredentialAccess(
  userId: string,
  userRole: string,
  credentialId: string,
  requiredPermission: PermissionLevel,
): Promise<void> {
  // SUPER_ADMIN and MANAGER bypass ACL checks
  if (userRole === 'SUPER_ADMIN' || userRole === 'MANAGER') return;

  const access = await prisma.credentialAccess.findUnique({
    where: {
      userId_credentialId: { userId, credentialId },
    },
  });

  if (!access) throw new ForbiddenError();

  if (PERMISSION_HIERARCHY[access.permission] < PERMISSION_HIERARCHY[requiredPermission]) {
    throw new ForbiddenError();
  }
}

// Mirror function for assets
export async function checkAssetAccess(
  userId: string,
  userRole: string,
  assetId: string,
  requiredPermission: PermissionLevel,
): Promise<void> {
  if (userRole === 'SUPER_ADMIN' || userRole === 'MANAGER') return;

  const access = await prisma.assetAccess.findUnique({
    where: {
      userId_assetId: { userId, assetId },
    },
  });

  if (!access) throw new ForbiddenError();

  if (PERMISSION_HIERARCHY[access.permission] < PERMISSION_HIERARCHY[requiredPermission]) {
    throw new ForbiddenError();
  }
}
```

### Pattern 3: Route Design

**What:** RESTful nested routes for ACL management.
**When to use:** All ACL endpoints.
**Example:**
```typescript
// Routes for credential access management
// POST   /api/credentials/:credentialId/access   — grant access
// DELETE /api/credentials/:credentialId/access/:userId — revoke access
// GET    /api/credentials/:credentialId/access   — list access

// Routes for asset access management
// POST   /api/assets/:assetId/access             — grant access
// DELETE /api/assets/:assetId/access/:userId     — revoke access
// GET    /api/assets/:assetId/access             — list access
```

All routes require `authenticate` + `requireRole('MANAGER')` (SUPER_ADMIN auto-passes via existing requireRole logic).

### Anti-Patterns to Avoid
- **Checking role AND ACL in middleware chain:** Don't create an Express middleware that does the DB lookup on every request. The ACL check needs the resource ID which comes from route params -- use a service-level function call, not middleware, for the actual permission check. The `requireResourceAccess` helper is a function, not Express middleware.
- **Separate "create" and "update" permission endpoints:** Use upsert. Granting VIEW then upgrading to EDIT should be the same endpoint, not two.
- **Returning 404 when access is denied:** A user without access should get 403, not 404. The resource exists; they just cannot access it. (Exception: if you want to hide resource existence, 404 is acceptable -- but the requirements say 403.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Permission hierarchy comparison | Manual if/else chains | A simple lookup table (`PERMISSION_HIERARCHY` map) | Adding new levels later is just a table entry, not logic changes |
| Unique constraint handling | Try/catch on Prisma unique errors | Prisma `upsert` for grants | Upsert is atomic and avoids race conditions |

**Key insight:** The schema already solves the hard part (unique constraints, cascade deletes, proper indexes). The application code just needs thin CRUD and a permission-level comparison helper.

## Common Pitfalls

### Pitfall 1: Forgetting SUPER_ADMIN/MANAGER Bypass in ACL Checks
**What goes wrong:** Every resource access requires an ACL row, so SUPER_ADMIN/MANAGER would need explicit grants on every resource to use the system.
**Why it happens:** Implementing ACL checks without considering role-based overrides.
**How to avoid:** The `checkCredentialAccess`/`checkAssetAccess` helpers MUST check `userRole` first and short-circuit for SUPER_ADMIN and MANAGER before hitting the database.
**Warning signs:** Tests fail when SUPER_ADMIN tries to access a resource they didn't explicitly get granted access to.

### Pitfall 2: Not Validating Resource and User Existence on Grant
**What goes wrong:** Granting access to a deleted credential or inactive user creates orphaned ACL rows.
**Why it happens:** Skipping existence checks and relying only on foreign key constraints.
**How to avoid:** Service layer must verify the credential/asset is not soft-deleted (`deletedAt: null`) and the user is active before granting. Foreign keys only prevent referencing non-existent IDs, not soft-deleted records.
**Warning signs:** ACL rows pointing to soft-deleted resources.

### Pitfall 3: Permission Level Semantics Confusion
**What goes wrong:** VIEW/EDIT/MANAGE meanings are unclear, leading to inconsistent enforcement in Phases 5 and 6.
**Why it happens:** Permission levels defined in schema but semantics not documented.
**How to avoid:** Define the semantics now and enforce them consistently:
- **VIEW** = Can read/reveal the resource
- **EDIT** = Can read + update the resource
- **MANAGE** = Can read + update + delete the resource + manage its access list
**Warning signs:** Different phases interpret EDIT differently.

### Pitfall 4: Race Condition on Revoke + Concurrent Access
**What goes wrong:** User's ACL row is deleted while they're mid-request on the resource.
**Why it happens:** ACL check happens at request start, actual data operation happens later.
**How to avoid:** This is acceptable for this application scale. The window is tiny and the impact is minimal (one extra permitted request). Don't over-engineer with pessimistic locking.
**Warning signs:** None -- this is a known acceptable trade-off for simplicity.

### Pitfall 5: Not Returning Useful ACL List Responses
**What goes wrong:** The "list access" endpoint returns raw join-table data with just user IDs.
**Why it happens:** Returning the CredentialAccess/AssetAccess rows without joining user data.
**How to avoid:** Include user email and name in the access list response via Prisma `include` or `select`:
```typescript
const accessList = await prisma.credentialAccess.findMany({
  where: { credentialId },
  select: {
    userId: true,
    permission: true,
    grantedAt: true,
    user: { select: { email: true, name: true } },
  },
});
```
**Warning signs:** Frontend would need a separate API call per user to display the access list.

## Code Examples

### Grant Access Validation Schema
```typescript
// validation.ts
import { z } from 'zod';
import { PermissionLevel } from '@prisma/client';

export const grantAccessSchema = z.object({
  userId: z.string().min(1),
  permission: z.nativeEnum(PermissionLevel).default('VIEW'),
});

export type GrantAccessInput = z.infer<typeof grantAccessSchema>;
```

### Controller Pattern (Thin)
```typescript
// controller.ts
export async function grant(req: Request, res: Response): Promise<void> {
  const { userId, permission } = parseBody(grantAccessSchema, req.body);
  const credentialId = req.params.credentialId as string;
  const access = await grantCredentialAccess(credentialId, userId, permission);
  res.status(200).json({ access });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const credentialId = req.params.credentialId as string;
  const userId = req.params.userId as string;
  await revokeCredentialAccess(credentialId, userId);
  res.status(204).send();
}

export async function list(req: Request, res: Response): Promise<void> {
  const credentialId = req.params.credentialId as string;
  const accessList = await listCredentialAccess(credentialId);
  res.status(200).json({ access: accessList });
}
```

### Test Setup Pattern
```typescript
// Follow describeWithDb pattern from users.test.ts
async function createTestCredential(createdById: string) {
  return prisma.credential.create({
    data: {
      friendlyName: 'Test Cred',
      encryptedValue: 'encrypted',
      iv: 'iv-value',
      authTag: 'auth-tag',
      createdById,
    },
  });
}

async function createTestAsset(createdById: string) {
  userCounter++;
  return prisma.asset.create({
    data: {
      assetId: `ASSET-${userCounter}`,
      name: 'Test Asset',
      category: 'HARDWARE',
      createdById,
    },
  });
}
```

### Cleanup in Tests
```typescript
// Must clean ACL tables before credentials/assets (foreign keys)
beforeEach(async () => {
  if (!canConnect) return;
  await prisma.credentialAccess.deleteMany();
  await prisma.assetAccess.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Role-only authorization | Role + per-resource ACLs | Standard practice | Fine-grained access control beyond coarse roles |
| ACL as separate service/microservice | ACL as join table + helper function | N/A (scale-dependent) | For this project size, a simple join table is correct -- no need for a policy engine |

**Not applicable for this phase:**
- No external ACL libraries (CASL, casbin) are warranted. The schema is simple: one join table per resource type with a permission level enum. A helper function is all that's needed.

## Open Questions

1. **Should the credential/asset creator automatically get MANAGE permission?**
   - What we know: The schema has `createdById` on credentials and assets. Phase 5/6 will create resources.
   - What's unclear: Whether the creator should implicitly have full access (via role check or auto-granted ACL row).
   - Recommendation: Auto-grant MANAGE to the creator in Phases 5/6 when creating a resource. This phase should document the convention but the actual grant happens at creation time in the credential/asset service, not here.

2. **Should revoking access from yourself be allowed?**
   - What we know: A user with MANAGE permission could theoretically revoke their own access.
   - What's unclear: Whether self-revocation should be blocked.
   - Recommendation: Allow it. If a MANAGER or SUPER_ADMIN needs to re-grant, they can. Don't add unnecessary guard rails.

3. **Should MANAGER role bypass be scoped?**
   - What we know: Currently MANAGER bypasses ACL checks entirely (same as SUPER_ADMIN).
   - What's unclear: Whether MANAGER should only manage resources they have explicit access to.
   - Recommendation: Keep MANAGER as a full bypass for v1 (matches the success criteria: "SUPER_ADMIN and Manager can grant or revoke"). Scoped management is a v2 concern.

## Sources

### Primary (HIGH confidence)
- Project codebase analysis: schema.prisma, existing middleware, module patterns, test patterns
- Prisma schema: CredentialAccess and AssetAccess models with unique constraints already exist
- Existing patterns: requireRole middleware, thin controller pattern, describeWithDb test guard

### Secondary (MEDIUM confidence)
- ACL design patterns: standard join-table approach is well-established for resource-level authorization in relational databases

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed, all existing dependencies
- Architecture: HIGH - Follows established module pattern exactly, schema already exists
- Pitfalls: HIGH - Derived from direct codebase analysis and standard ACL implementation experience

**Research date:** 2026-07-29
**Valid until:** 2026-08-28 (stable -- no external dependencies to change)
