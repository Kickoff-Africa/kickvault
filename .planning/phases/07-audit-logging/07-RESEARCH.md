# Phase 7: Audit Logging - Research

**Researched:** 2026-07-30
**Domain:** Audit logging, immutability enforcement, cursor pagination, CSV export
**Confidence:** HIGH

## Summary

Phase 7 builds on an existing foundation: the AuditLog Prisma model already exists with the correct schema (no updatedAt), a PostgreSQL trigger already blocks UPDATE/DELETE at the database layer, and `createAuditLog()` helper is already in use. The remaining work is: (1) add application-layer immutability enforcement via Prisma client extensions, (2) add missing audit log calls for credential CREATE/UPDATE/DELETE, (3) build the audit log API with cursor-based pagination, filtering, and CSV export, and (4) write comprehensive tests.

Key discovery: Prisma `$use` middleware was removed in Prisma 6.14.0. The project uses `@prisma/client@^6.19.3`, so the `$extends` query component API must be used instead.

**Primary recommendation:** Use Prisma `$extends` query component to throw on AuditLog update/delete/updateMany/deleteMany operations. Build cursor pagination using Prisma's native `cursor` + `skip` + `take` with `orderBy: { createdAt: 'desc' }`. Use built-in string concatenation for CSV (no library needed for simple flat data).

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @prisma/client | ^6.19.3 | ORM, query building, cursor pagination | Already in project |
| zod | ^4.4.3 | Query param validation with coercion | Already in project |
| express | ^5.2.1 | HTTP routing, response streaming | Already in project |

### Supporting (No New Dependencies)
No new libraries are needed. CSV export is simple enough to hand-roll with string operations. Cursor pagination is built into Prisma. Query param validation uses Zod coercion already established in the project.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── config/
│   └── database.ts           # MODIFY: add $extends for AuditLog immutability
├── services/
│   └── audit.service.ts      # MODIFY: add list, export functions
├── modules/
│   └── audit-logs/
│       ├── audit-logs.validation.ts   # Query param schemas
│       ├── audit-logs.service.ts      # List + export logic
│       ├── audit-logs.controller.ts   # Thin controllers
│       ├── audit-logs.routes.ts       # Route definitions
│       └── audit-logs.test.ts         # Integration tests
├── modules/credentials/
│   └── credentials.service.ts  # MODIFY: add missing audit log calls
```

### Pattern 1: Prisma Client Extension for Immutability
**What:** Block UPDATE/DELETE on AuditLog at the application layer using `$extends`
**When to use:** At PrismaClient initialization in `database.ts`
**Example:**
```typescript
// Source: https://www.prisma.io/docs/orm/prisma-client/client-extensions/query
import { PrismaClient } from '@prisma/client';

const basePrisma = new PrismaClient();

export const prisma = basePrisma.$extends({
  query: {
    auditLog: {
      async update() {
        throw new Error('AuditLog entries are immutable: update is forbidden');
      },
      async updateMany() {
        throw new Error('AuditLog entries are immutable: updateMany is forbidden');
      },
      async delete() {
        throw new Error('AuditLog entries are immutable: delete is forbidden');
      },
      async deleteMany() {
        throw new Error('AuditLog entries are immutable: deleteMany is forbidden');
      },
    },
  },
});
```

**CRITICAL NOTE:** `$extends` returns a new client instance with a different type. The existing `prisma` export type will change. All existing code using `prisma.auditLog.deleteMany()` in test `beforeEach`/`afterAll` cleanup will break. Two solutions:
1. Export both `basePrisma` (for test cleanup) and `prisma` (for app code)
2. Use raw SQL `TRUNCATE audit_logs CASCADE` in tests instead of deleteMany

**Recommended approach:** Export the extended client as `prisma` for app code. In tests, use `prisma.$executeRawUnsafe('DELETE FROM audit_logs')` or temporarily disable the trigger for test cleanup. Actually, simpler: since the DB trigger also blocks DELETE, tests already must handle this. Check if existing tests actually pass with the trigger active -- they likely use a test database where the trigger exists.

**IMPORTANT DISCOVERY:** Existing tests call `await prisma.auditLog.deleteMany()` in beforeEach/afterAll. If the DB trigger is active in test DB, these calls would fail. This means either: (a) tests run against a DB without the trigger, or (b) deleteMany somehow bypasses the row-level trigger. PostgreSQL BEFORE triggers fire FOR EACH ROW on DELETE, but `DELETE FROM audit_logs` where no rows exist would not fire the trigger. If rows exist, it would fail. This needs validation during implementation.

### Pattern 2: Cursor-Based Pagination (Newest-First)
**What:** Use Prisma native cursor pagination with descending order
**When to use:** For the audit log listing endpoint
**Example:**
```typescript
// Source: https://www.prisma.io/docs/orm/prisma-client/queries/pagination
interface PaginationParams {
  cursor?: string;   // last seen audit log ID
  limit: number;     // page size (default 50, max 100)
  action?: string;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
}

async function listAuditLogs(params: PaginationParams) {
  const { cursor, limit, action, userId, startDate, endDate } = params;

  const where: Prisma.AuditLogWhereInput = {
    ...(action && { action }),
    ...(userId && { userId }),
    ...(startDate || endDate ? {
      createdAt: {
        ...(startDate && { gte: startDate }),
        ...(endDate && { lte: endDate }),
      },
    } : {}),
  };

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,          // fetch one extra to determine hasMore
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1,                // skip the cursor itself
    }),
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  const hasMore = logs.length > limit;
  const items = hasMore ? logs.slice(0, limit) : logs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, hasMore };
}
```

**Key detail:** `take: limit + 1` fetches one extra record to determine if there's a next page without a separate count query. This is the standard pattern.

**Ordering note:** Using `orderBy: { createdAt: 'desc' }` with cursor pagination works because `createdAt` has an index (@@index([createdAt]) in schema). The cursor uses `id` (primary key), and Prisma handles the compound ordering internally. For pure cursor pagination, using `id` as cursor with `createdAt` desc ordering is correct since cuid IDs are not time-sorted -- but Prisma's cursor just uses the id to find the starting position, then applies the orderBy. This works correctly.

### Pattern 3: Query Param Validation with Zod Coercion
**What:** Validate and coerce query string params (all strings from Express)
**When to use:** In audit-logs.validation.ts
**Example:**
```typescript
import { z } from 'zod';

export const listAuditLogsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'REVEAL']).optional(),
  userId: z.string().optional(),
  startDate: z.string().datetime().optional(),   // ISO 8601
  endDate: z.string().datetime().optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
```

**Project precedent:** `z.coerce.number()` is already used in `config/env.ts`. `z.string().datetime()` is already used in `credentials.validation.ts`.

### Pattern 4: CSV Export (No Library)
**What:** Generate CSV from audit log data using plain string operations
**When to use:** For the SUPER_ADMIN CSV export endpoint
**Example:**
```typescript
function auditLogsToCsv(logs: AuditLogWithUser[]): string {
  const header = 'ID,Timestamp,User Email,User Name,Action,Target Type,Target ID,IP Address\n';
  const rows = logs.map(log =>
    [
      log.id,
      log.createdAt.toISOString(),
      escapeCsv(log.user.email),
      escapeCsv(log.user.name),
      log.action,
      log.targetType,
      log.targetId ?? '',
      log.ipAddress ?? '',
    ].join(',')
  ).join('\n');
  return header + rows;
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
```

**Response headers for CSV download:**
```typescript
res.setHeader('Content-Type', 'text/csv');
res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
res.send(csvContent);
```

### Anti-Patterns to Avoid
- **Don't use offset-based pagination:** Offset pagination degrades with large datasets and can miss/duplicate entries as new logs are added
- **Don't use `$use` middleware:** Removed in Prisma 6.14.0, use `$extends` query component instead
- **Don't forget to handle the extended client type:** `$extends` returns a new type, not `PrismaClient`
- **Don't stream CSV for audit logs:** Unless expecting millions of rows, simple string concatenation is simpler and sufficient. Streaming adds complexity for marginal benefit at typical audit log sizes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cursor pagination | Custom SQL with OFFSET | Prisma `cursor` + `skip` + `take` | Prisma handles cursor positioning and ordering correctly |
| CSV parsing/escaping | Full CSV library | Simple `escapeCsv()` helper | Audit log data is flat, predictable structure; full library is overkill |
| Query param coercion | Manual parseInt/parseFloat | Zod `z.coerce` | Already used in project, provides type safety |
| Date validation | Manual Date parsing | `z.string().datetime()` | Already used in credentials validation |

## Common Pitfalls

### Pitfall 1: Test Cleanup vs Immutability
**What goes wrong:** Tests call `prisma.auditLog.deleteMany()` for cleanup. With `$extends` blocking delete, and the DB trigger also blocking DELETE, test cleanup fails.
**Why it happens:** Immutability enforcement is global -- it applies in test context too.
**How to avoid:** Either (a) export a `basePrisma` without extensions for test use, or (b) use raw SQL `TRUNCATE audit_logs CASCADE` which bypasses row-level triggers, or (c) use `prisma.$executeRawUnsafe('TRUNCATE audit_logs CASCADE')`.
**Warning signs:** Tests failing with "AuditLog entries are immutable" errors.

### Pitfall 2: Extended Client Type Mismatch
**What goes wrong:** `$extends` returns a different type than `PrismaClient`. Code that types `prisma` as `PrismaClient` will get type errors.
**Why it happens:** Prisma's extension system creates a new type that includes the extension constraints.
**How to avoid:** Use `typeof prisma` instead of `PrismaClient` when typing the client. Or use type inference and avoid explicit typing.
**Warning signs:** TypeScript errors about missing properties or incompatible types.

### Pitfall 3: Missing Audit Logs on Credentials
**What goes wrong:** Credential CREATE, UPDATE, DELETE actions are not audit-logged. Only REVEAL is.
**Why it happens:** The audit logging was partially implemented -- assets have full coverage but credentials don't.
**How to avoid:** Add `createAuditLog()` calls to `createCredential()`, `updateCredential()`, and `deleteCredential()` in `credentials.service.ts`.
**Warning signs:** Incomplete audit trail for credential lifecycle events.

### Pitfall 4: Cursor Pagination with Descending Order
**What goes wrong:** Next page returns wrong results or infinite loops.
**Why it happens:** Cursor + orderBy interaction can be confusing. When using `orderBy: { createdAt: 'desc' }`, cursor starts from a position and goes "forward" in the desc direction (older records).
**How to avoid:** Always use `skip: 1` when cursor is provided (to skip the cursor record itself). Use `take: limit + 1` pattern to detect hasMore. Test with known data.
**Warning signs:** Duplicate records across pages, missing records, or nextCursor pointing to wrong record.

### Pitfall 5: requireRole with No Args
**What goes wrong:** Using `requireRole()` without arguments doesn't restrict to any role.
**Why it happens:** Looking at the implementation, `requireRole()` with no args means `allowedRoles` is empty. Since SUPER_ADMIN always passes (line 9 of requireRole.ts), and empty allowedRoles means no other role is allowed, `requireRole()` effectively means SUPER_ADMIN only.
**How to avoid:** Use `requireRole()` (no args) for SUPER_ADMIN-only endpoints like CSV export. Use `requireRole('MANAGER')` for SUPER_ADMIN + MANAGER.

### Pitfall 6: ESM Import Extensions
**What goes wrong:** Import without `.js` extension fails at runtime.
**Why it happens:** Project uses ESM with Node16 module resolution -- all relative imports need `.js` extension.
**How to avoid:** Always use `.js` extension on relative imports (e.g., `import { foo } from './bar.js'`).
**Warning signs:** Runtime "ERR_MODULE_NOT_FOUND" errors.

## Code Examples

### Audit Log Service - Complete List Function
```typescript
// Source: Prisma pagination docs + project patterns
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';

export async function listAuditLogs(params: {
  cursor?: string;
  limit: number;
  action?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const { cursor, limit, action, userId, startDate, endDate } = params;

  const where: Prisma.AuditLogWhereInput = {};
  if (action) where.action = action;
  if (userId) where.userId = userId;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  const hasMore = logs.length > limit;
  const items = hasMore ? logs.slice(0, limit) : logs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, hasMore };
}
```

### Audit Log Controller - List Handler
```typescript
// Source: project thin controller pattern (assets.controller.ts)
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { listAuditLogsQuerySchema } from './audit-logs.validation.js';
import { listAuditLogs } from './audit-logs.service.js';
import { ValidationError } from '../../lib/errors.js';

export async function list(req: Request, res: Response): Promise<void> {
  let query;
  try {
    query = listAuditLogsQuerySchema.parse(req.query);
  } catch (err) {
    if (err instanceof ZodError) throw new ValidationError(err.issues[0].message);
    throw err;
  }
  const result = await listAuditLogs(query);
  res.json(result);
}
```

### CSV Export Controller
```typescript
export async function exportCsv(req: Request, res: Response): Promise<void> {
  let query;
  try {
    query = exportAuditLogsQuerySchema.parse(req.query);
  } catch (err) {
    if (err instanceof ZodError) throw new ValidationError(err.issues[0].message);
    throw err;
  }
  const csv = await exportAuditLogsCsv(query);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
  res.send(csv);
}
```

### Route Registration
```typescript
// Source: project route patterns (assets.routes.ts)
import { Router } from 'express';
import * as auditLogsController from './audit-logs.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

// All authenticated users can view audit logs (or restrict to MANAGER+)
router.get('/api/audit-logs', authenticate, requireRole('MANAGER'), auditLogsController.list);

// SUPER_ADMIN only: CSV export
router.get('/api/audit-logs/export', authenticate, requireRole(), auditLogsController.exportCsv);

export { router as auditLogsRoutes };
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `prisma.$use()` middleware | `prisma.$extends()` query component | Prisma 6.14.0 | Must use $extends, $use is removed |
| Offset pagination (`skip` + `take`) | Cursor pagination (`cursor` + `skip` + `take`) | Long-standing best practice | Better performance, no drift with new entries |

**Deprecated/outdated:**
- `prisma.$use()`: Removed in Prisma 6.14.0, replaced by `$extends` query component
- Offset-based pagination for append-heavy tables: Cursor-based is standard

## Open Questions

1. **Test cleanup with immutability trigger**
   - What we know: Tests call `prisma.auditLog.deleteMany()`. The DB trigger blocks row-level DELETE. `$extends` will also block deleteMany at app layer.
   - What's unclear: Whether existing tests pass with the trigger active, or if the test DB doesn't have the trigger applied.
   - Recommendation: Use `TRUNCATE audit_logs CASCADE` via raw SQL for test cleanup (TRUNCATE bypasses row-level triggers in PostgreSQL). Export `basePrisma` for test contexts if needed.

2. **Who can view audit logs?**
   - What we know: SUPER_ADMIN can export CSV. The requirements don't specify who can LIST audit logs.
   - What's unclear: Should all authenticated users see audit logs, or only MANAGER+?
   - Recommendation: Restrict to MANAGER+ (SUPER_ADMIN and MANAGER) since audit logs contain sensitive operational data. This aligns with the existing role hierarchy.

3. **CSV export size limits**
   - What we know: SUPER_ADMIN can export CSV. No size limit specified.
   - What's unclear: Whether there should be a maximum export size or date range limit.
   - Recommendation: Apply the same date range filters as listing. For safety, cap at 10,000 rows per export or require date range filters. This prevents OOM on very large datasets.

## Sources

### Primary (HIGH confidence)
- Prisma schema at `prisma/schema.prisma` - AuditLog model structure verified
- Existing migration `20260729000002_audit_log_trigger` - DB trigger already exists and blocks UPDATE/DELETE
- `src/services/audit.service.ts` - createAuditLog helper verified
- `src/modules/credentials/credentials.service.ts` - confirmed CREATE/UPDATE/DELETE missing audit logs
- `src/modules/assets/assets.service.ts` - confirmed CREATE/UPDATE/DELETE have audit logs
- `src/config/database.ts` - current PrismaClient setup verified (no extensions yet)

### Secondary (MEDIUM confidence)
- [Prisma Client Extensions - Query Component](https://www.prisma.io/docs/orm/prisma-client/client-extensions/query) - $extends API for blocking operations
- [Prisma Pagination Docs](https://www.prisma.io/docs/orm/prisma-client/queries/pagination) - cursor-based pagination API
- [Prisma $use removal issue](https://github.com/prisma/prisma/issues/27891) - confirmed $use removed in 6.14.0

### Tertiary (LOW confidence)
- CSV export pattern is based on standard Node.js string operations (no external source needed, straightforward)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in project, no new deps needed
- Architecture: HIGH - follows established project patterns exactly
- Pitfalls: HIGH - verified against actual codebase (found real issues like missing credential audit logs)
- Immutability enforcement: HIGH - DB trigger already exists, $extends API is well-documented
- Cursor pagination: HIGH - Prisma native feature, well-documented

**Research date:** 2026-07-30
**Valid until:** 2026-08-30 (stable patterns, all deps already pinned)
