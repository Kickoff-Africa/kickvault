# Phase 6: Asset Management - Research

**Researched:** 2026-07-30
**Domain:** Asset CRUD with status state machine, category enforcement, access-scoped operations
**Confidence:** HIGH

## Summary

This phase implements Asset CRUD operations mirroring the Credential module pattern established in Phase 5, with the key addition of a status state machine. The codebase already has the Prisma schema (Asset model, AssetCategory enum, AssetStatus enum), the access control infrastructure (checkAssetAccess, grantAssetAccess/revokeAssetAccess), and audit logging in place.

The primary new complexity is the status transition state machine (ASSET-03). All other operations (create, read, update, delete, list with access scoping) follow the credential module pattern exactly.

**Primary recommendation:** Mirror `src/modules/credentials/` structure exactly, adding a status transition validator as the only net-new logic.

## Standard Stack

### Core (Already in Codebase)
| Library | Purpose | Status |
|---------|---------|--------|
| Prisma | ORM, Asset/AssetAccess models | Schema exists, ready to use |
| Zod | Request validation | Same pattern as credentials.validation.ts |
| Express 5 | Router/controller | Same pattern as credentials.routes.ts |
| Vitest + Supertest | Integration tests | Same pattern as credentials.test.ts |

### No New Dependencies Required

This phase requires zero new npm packages. Everything needed is already installed and patterned.

## Architecture Patterns

### Recommended Module Structure
```
src/modules/assets/
  assets.validation.ts    # Zod schemas for create/update
  assets.service.ts       # Business logic + state machine
  assets.controller.ts    # Thin: parse + service call + response
  assets.routes.ts        # Express routes with authenticate middleware
  assets.test.ts          # Integration tests
```

### Pattern 1: Mirror Credential Module Exactly
**What:** Copy the credential module's validation -> service -> controller -> routes pipeline
**When to use:** For all CRUD operations (create, get, list, update, delete)

The credential module provides a complete, tested template:
- `createCredentialSchema` -> `createAssetSchema`
- `SAFE_CREDENTIAL_SELECT` -> standard Asset select (no sensitive fields to exclude, but keep pattern consistent)
- `listCredentials` with role-based scoping -> `listAssets` with same pattern
- Soft delete via `deletedAt` -> identical pattern
- `checkCredentialAccess` -> `checkAssetAccess` (already exists)
- Auto-grant MANAGE to creator -> same pattern with `grantAssetAccess`

### Pattern 2: Status State Machine
**What:** Enforce valid status transitions at the service layer
**When to use:** On every status update via the update endpoint

```typescript
// Status transition map - the core of ASSET-03
const VALID_TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  ACTIVE: [AssetStatus.MAINTENANCE, AssetStatus.RETIRED, AssetStatus.LOST],
  MAINTENANCE: [AssetStatus.ACTIVE],
  LOST: [AssetStatus.ACTIVE, AssetStatus.RETIRED],
  RETIRED: [], // Terminal - admin override only
};

function validateStatusTransition(
  currentStatus: AssetStatus,
  newStatus: AssetStatus,
  userRole: string,
): void {
  if (currentStatus === newStatus) return; // No-op, allow
  
  // SUPER_ADMIN can override RETIRED -> any status
  if (currentStatus === AssetStatus.RETIRED && userRole === 'SUPER_ADMIN') return;
  
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed.includes(newStatus)) {
    throw new ValidationError(
      `Cannot transition from ${currentStatus} to ${newStatus}`
    );
  }
}
```

### Pattern 3: Access-Scoped List (from credentials)
**What:** Privileged users (SUPER_ADMIN/MANAGER) see all assets; MEMBER/VIEWER see only assets they have explicit access to
**When to use:** GET /api/assets list endpoint

```typescript
const isPrivileged = userRole === 'SUPER_ADMIN' || userRole === 'MANAGER';
const whereClause = isPrivileged
  ? { deletedAt: null }
  : { deletedAt: null, assetAccess: { some: { userId } } };
```

### Pattern 4: Audit Logging (from Phase 5 decisions)
**What:** Call createAuditLog before destructive/sensitive operations
**When to use:** On create, update (especially status changes), delete

```typescript
await createAuditLog({
  userId,
  action: 'UPDATE_STATUS',
  targetType: 'ASSET',
  targetId: id,
  metadata: { from: currentStatus, to: newStatus },
});
```

### Anti-Patterns to Avoid
- **Status validation in controller:** Status transition logic belongs in the service layer, not controller or validation schema
- **Zod enum refinement for transitions:** Don't try to encode the state machine in Zod. Zod validates the input shape; the service validates business rules
- **Skipping access check before status read:** Must fetch current status from DB to validate transitions; always check access first

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Access control | Custom ACL check | `checkAssetAccess()` from requireResourceAccess.ts | Already exists, matches credential pattern |
| Access granting | Custom grant logic | `grantAssetAccess()` from asset-access.service.ts | Already exists with upsert, user validation |
| Audit logging | Custom log writes | `createAuditLog()` from audit.service.ts | Already exists, append-only |
| Soft delete | Custom delete logic | `deletedAt` pattern from credentials | Proven pattern, consistent across app |
| Validation parsing | Custom error handling | `parseBody()` helper from credentials.controller.ts | Zod-to-ValidationError conversion |
| Permission hierarchy | Number comparison | `PERMISSION_HIERARCHY` from requireResourceAccess.ts | VIEW(1) < EDIT(2) < MANAGE(3) |

**Key insight:** The credential module is the template. The only net-new code is the status transition validator.

## Common Pitfalls

### Pitfall 1: Forgetting Admin Override for RETIRED Status
**What goes wrong:** RETIRED is terminal per spec, but SUPER_ADMIN must be able to override
**Why it happens:** Easy to make RETIRED -> [] with no exceptions
**How to avoid:** Check userRole === 'SUPER_ADMIN' before rejecting RETIRED transitions
**Warning signs:** Test for admin override missing

### Pitfall 2: assetId vs id Confusion
**What goes wrong:** The Asset model has both `id` (cuid, primary key) and `assetId` (user-facing unique identifier like "HW-001")
**Why it happens:** Both are unique identifiers, but serve different purposes
**How to avoid:** Use `id` for all internal lookups, route params, and access control. `assetId` is a user-facing display/search field set at creation
**Warning signs:** Route params using assetId when they should use id; checkAssetAccess takes the internal `id`, not the user-facing `assetId`

### Pitfall 3: Unique Constraint on assetId (P2002)
**What goes wrong:** Creating asset with duplicate assetId throws unhandled Prisma error
**Why it happens:** `assetId` has @unique constraint in schema
**How to avoid:** Catch Prisma P2002 error code and throw ConflictError('Asset ID already exists')
**Warning signs:** Unhandled 500 errors on duplicate asset IDs

### Pitfall 4: Missing deletedAt Filter
**What goes wrong:** Queries return soft-deleted assets
**Why it happens:** Forgetting `deletedAt: null` in where clauses
**How to avoid:** Always include `deletedAt: null` in every query (get, list, update, delete)
**Warning signs:** Deleted assets appearing in lists

### Pitfall 5: Status Update Without Current Status Check
**What goes wrong:** Race condition where status changes between read and write
**Why it happens:** Reading status, then updating without where-clause guard
**How to avoid:** Include current status in the Prisma update where clause, or use a transaction
**Warning signs:** Invalid transitions going through under concurrent requests

### Pitfall 6: FK Cleanup Order in Tests
**What goes wrong:** Test cleanup fails due to foreign key constraints
**Why it happens:** Deleting assets before asset_access entries
**How to avoid:** Delete in order: auditLogs -> assetAccess -> assets -> sessions -> users
**Warning signs:** Test teardown errors about foreign key violations

## Code Examples

### Create Asset Validation Schema
```typescript
// assets.validation.ts
import { z } from 'zod';

export const createAssetSchema = z.object({
  assetId: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  category: z.enum(['HARDWARE', 'SOFTWARE', 'DIGITAL', 'INTANGIBLE']),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED', 'LOST']).optional().default('ACTIVE'),
  location: z.string().min(1).max(255).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateAssetSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  category: z.enum(['HARDWARE', 'SOFTWARE', 'DIGITAL', 'INTANGIBLE']).optional(),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED', 'LOST']).optional(),
  location: z.string().min(1).max(255).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).refine(
  (data) => Object.values(data).some(v => v !== undefined),
  { message: 'At least one field must be provided' },
);

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
```

### Create Asset Service
```typescript
// assets.service.ts — createAsset
export async function createAsset(data: CreateAssetInput, createdById: string) {
  try {
    const asset = await prisma.asset.create({
      data: {
        assetId: data.assetId,
        name: data.name,
        category: data.category,
        status: data.status ?? 'ACTIVE',
        location: data.location,
        notes: data.notes,
        createdById,
      },
    });
    // Auto-grant MANAGE access to creator (mirrors credential pattern)
    await grantAssetAccess(asset.id, createdById, PermissionLevel.MANAGE);
    
    await createAuditLog({
      userId: createdById,
      action: 'CREATE',
      targetType: 'ASSET',
      targetId: asset.id,
    });
    
    return asset;
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      throw new ConflictError('Asset ID already exists');
    }
    throw err;
  }
}
```

### Update Asset with Status Transition
```typescript
// assets.service.ts — updateAsset (status transition excerpt)
export async function updateAsset(
  id: string,
  data: UpdateAssetInput,
  userId: string,
  userRole: string,
) {
  await checkAssetAccess(userId, userRole, id, PermissionLevel.EDIT);
  const existing = await prisma.asset.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Asset not found');

  // Validate status transition if status is being changed
  if (data.status !== undefined && data.status !== existing.status) {
    validateStatusTransition(existing.status, data.status as AssetStatus, userRole);
    
    await createAuditLog({
      userId,
      action: 'UPDATE_STATUS',
      targetType: 'ASSET',
      targetId: id,
      metadata: { from: existing.status, to: data.status },
    });
  }

  return prisma.asset.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.category !== undefined && { category: data.category }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.location !== undefined && { location: data.location }),
      ...(data.notes !== undefined && { notes: data.notes }),
    },
  });
}
```

### Routes Pattern
```typescript
// assets.routes.ts
const router = Router();

router.post('/api/assets', authenticate, assetsController.create);
router.get('/api/assets', authenticate, assetsController.list);
router.get('/api/assets/:id', authenticate, assetsController.getOne);
router.patch('/api/assets/:id', authenticate, assetsController.update);
router.delete('/api/assets/:id', authenticate, assetsController.remove);

export { router as assetsRoutes };
```

### Test Cleanup Order
```typescript
// assets.test.ts — beforeEach/afterAll
beforeEach(async () => {
  if (!canConnect) return;
  await prisma.auditLog.deleteMany();
  await prisma.assetAccess.deleteMany();
  await prisma.credentialAccess.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});
```

## State Machine Reference

```
             +-----------+
             |           |
     +------>| ACTIVE    |<------+
     |       |           |       |
     |       +-----+-----+      |
     |             |             |
     |    +--------+--------+   |
     |    |        |        |   |
     |    v        v        v   |
  +--+----+  +----+----+ +-+---+---+
  |MAINT- |  |RETIRED  | |LOST     |
  |ENANCE |  |(terminal| |         |
  |       |  | unless  | |    +----+
  +-------+  | admin)  | |    |
              +---------+ +----v---+
                                   |
                          (to ACTIVE
                           or RETIRED)
```

Valid transitions:
- ACTIVE -> MAINTENANCE, RETIRED, LOST
- MAINTENANCE -> ACTIVE
- LOST -> ACTIVE, RETIRED
- RETIRED -> (none; SUPER_ADMIN override required)

## Open Questions

1. **Should category be editable after creation?**
   - The update schema includes category as optional. Requirements don't explicitly forbid it.
   - Recommendation: Allow it — the schema supports it and there's no business reason to lock it.

2. **Should assetId be editable?**
   - assetId is the user-facing identifier (e.g., "HW-001"). Changing it could break external references.
   - Recommendation: Do NOT allow assetId updates. Omit from update schema.

3. **Audit log granularity for non-status updates**
   - Phase 5 decision says "createAuditLog called before any destructive/sensitive operation"
   - Recommendation: Audit CREATE, DELETE, and STATUS_CHANGE. Regular field updates (name, location, notes) are optional but status changes are mandatory since they represent business state transitions.

## Sources

### Primary (HIGH confidence)
- `prisma/schema.prisma` — Asset model, enums, AssetAccess join table
- `src/modules/credentials/` — Complete CRUD module template (all 5 files)
- `src/middleware/requireResourceAccess.ts` — checkAssetAccess already implemented
- `src/modules/asset-access/asset-access.service.ts` — grantAssetAccess already implemented
- `src/services/audit.service.ts` — createAuditLog helper
- `src/lib/errors.ts` — ConflictError, NotFoundError, ValidationError, ForbiddenError

### Secondary (HIGH confidence)
- `src/modules/credentials/credentials.test.ts` — Test pattern template
- `src/app.ts` — Module registration pattern
- `src/modules/asset-access/asset-access.routes.ts` — Asset access routes already mounted

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in codebase, no new dependencies
- Architecture: HIGH - Direct mirror of credential module, pattern proven
- State machine: HIGH - Requirements explicitly define all transitions
- Pitfalls: HIGH - Derived from actual codebase patterns and Prisma constraints

**Research date:** 2026-07-30
**Valid until:** 2026-09-30 (stable; no external dependencies to go stale)
