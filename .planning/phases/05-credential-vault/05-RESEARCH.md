# Phase 5: Credential Vault - Research

**Researched:** 2026-07-30
**Domain:** Encrypted credential CRUD with masked responses, secure reveal, rate limiting, audit logging
**Confidence:** HIGH

## Summary

Phase 5 builds the core credential CRUD module on top of infrastructure already in place. The crypto module (`src/lib/crypto.ts`) provides AES-256-GCM encrypt/decrypt with HKDF key derivation and key versioning. The Prisma schema already defines the `Credential` model with `encryptedValue`, `iv`, `authTag`, `keyVersion`, `expiresAt`, `deletedAt`, and `createdById` fields. The `CredentialAccess` join table and `checkCredentialAccess` middleware already exist. The `grantCredentialAccess` service is already built (used for auto-granting creator MANAGE access on create).

The main work is: (1) credential service layer (create, list, get, update, soft-delete), (2) credential controller + routes with Zod validation, (3) a secure `/reveal` endpoint with per-user rate limiting and audit logging, (4) masking logic that strips secret fields from all responses, (5) integration tests.

**Primary recommendation:** Follow the established module convention (validation.ts -> service.ts -> controller.ts -> routes.ts) exactly as credential-access and auth modules do. Use `express-rate-limit` with a per-user `keyGenerator` for the reveal endpoint. Build a lightweight audit logging helper that writes to the existing `AuditLog` model. Never return encrypted fields (encryptedValue, iv, authTag, keyVersion) in any response except the reveal endpoint which returns only the decrypted plaintext.

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^5.2.1 | HTTP framework | Already in use |
| zod | ^4.4.3 | Input validation | Already in use for all modules |
| @prisma/client | ^6.19.3 | Database ORM | Already in use |
| node:crypto | built-in | AES-256-GCM encryption | Already implemented in src/lib/crypto.ts |

### New Dependencies
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| express-rate-limit | ^8.6 | Per-user rate limiting on reveal endpoint | Already in STACK.md as planned dependency |

### No Alternatives Needed

Everything required is either already installed or is `express-rate-limit` which was decided in the initial stack research. No new library decisions needed.

**Installation:**
```bash
npm install express-rate-limit
```

## Architecture Patterns

### Module Structure (follow existing convention)
```
src/modules/credentials/
  credentials.validation.ts   # Zod schemas for create, update, reveal
  credentials.service.ts      # Business logic: CRUD + encrypt/decrypt
  credentials.controller.ts   # Thin: parse + service call + response
  credentials.routes.ts       # Express router with middleware chain
  credentials.test.ts         # Integration tests with describeWithDb
```

### Supporting Files
```
src/services/
  audit.service.ts            # Reusable audit log writer (new)
src/middleware/
  rateLimiter.ts              # express-rate-limit factory for reveal (new)
```

### Pattern 1: Encrypt on Write, Mask on Read
**What:** When creating or updating a credential, encrypt the secret immediately and store only ciphertext. On read (list/get), never include encrypted columns. Only the `/reveal` endpoint decrypts.
**When to use:** Every credential operation.
**Example:**
```typescript
// credentials.service.ts - CREATE
import { encrypt, decrypt } from '../../lib/crypto.js';

export async function createCredential(input: CreateCredentialInput, userId: string) {
  const { encryptedValue, iv, authTag, keyVersion } = encrypt(input.secret);

  const credential = await prisma.$transaction(async (tx) => {
    const cred = await tx.credential.create({
      data: {
        friendlyName: input.friendlyName,
        systemHost: input.systemHost,
        username: input.username,
        encryptedValue,
        iv,
        authTag,
        keyVersion,
        expiresAt: input.expiresAt,
        createdById: userId,
      },
      select: SAFE_CREDENTIAL_SELECT,
    });

    // Auto-grant creator MANAGE access
    await tx.credentialAccess.create({
      data: { userId, credentialId: cred.id, permission: 'MANAGE' },
    });

    return cred;
  });

  return credential;
}
```

### Pattern 2: SAFE_CREDENTIAL_SELECT (Masking)
**What:** A Prisma `select` object that explicitly includes only safe fields, never encrypted columns. Mirrors the `SAFE_USER_SELECT` pattern from users.service.ts.
**When to use:** Every query that returns credential data (list, get, create, update).
**Example:**
```typescript
const SAFE_CREDENTIAL_SELECT = {
  id: true,
  friendlyName: true,
  systemHost: true,
  username: true,
  expiresAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  // NEVER include: encryptedValue, iv, authTag, keyVersion, deletedAt
} as const;
```

### Pattern 3: Secure Reveal with Audit-Before-Decrypt
**What:** POST /credentials/:id/reveal logs the audit entry BEFORE decryption. If decryption fails, the audit log still records the attempt.
**When to use:** The reveal endpoint only.
**Example:**
```typescript
export async function revealCredential(credentialId: string, userId: string, ip?: string, userAgent?: string) {
  const credential = await prisma.credential.findFirst({
    where: { id: credentialId, deletedAt: null },
  });
  if (!credential) throw new NotFoundError('Credential not found');

  // Audit BEFORE decrypt
  await createAuditLog({
    action: 'CREDENTIAL_REVEAL',
    targetType: 'Credential',
    targetId: credentialId,
    userId,
    ipAddress: ip,
    userAgent,
  });

  const plaintext = decrypt({
    encryptedValue: credential.encryptedValue,
    iv: credential.iv,
    authTag: credential.authTag,
    keyVersion: credential.keyVersion,
  });

  return { secret: plaintext };
}
```

### Pattern 4: Per-User Rate Limiting on Reveal
**What:** Use express-rate-limit with keyGenerator returning `req.user.id` to enforce 10 reveals/min/user.
**When to use:** Only the reveal endpoint.
**Example:**
```typescript
import rateLimit from 'express-rate-limit';

export const revealRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  keyGenerator: (req) => req.user!.id,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reveal requests. Try again later.' },
});
```

### Pattern 5: Soft Delete
**What:** Set `deletedAt = new Date()` instead of deleting rows. All queries filter `deletedAt: null`.
**When to use:** Credential delete operations.
**Example:**
```typescript
export async function deleteCredential(credentialId: string) {
  await prisma.credential.update({
    where: { id: credentialId },
    data: { deletedAt: new Date() },
  });
}
```

### Pattern 6: Audit Log Service
**What:** A thin helper that writes to the AuditLog table. The model already exists in the schema.
**When to use:** Reveal endpoint (required), and optionally create/update/delete for traceability.
**Example:**
```typescript
// src/services/audit.service.ts
import { prisma } from '../config/database.js';

interface AuditEntry {
  action: string;
  targetType: string;
  targetId?: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export async function createAuditLog(entry: AuditEntry) {
  return prisma.auditLog.create({ data: entry });
}
```

### Anti-Patterns to Avoid
- **Returning encrypted columns in API responses:** Never include encryptedValue, iv, authTag in any response. Use SAFE_CREDENTIAL_SELECT exclusively.
- **GET for reveal:** Reveal MUST be POST because it has side effects (audit log, rate limit consumption). GET would be cached by proxies and logged in access logs.
- **Audit after decrypt:** Always log BEFORE decrypting. If decryption throws, the attempt is still recorded.
- **Decrypting in list/get endpoints:** Only the reveal endpoint should ever call `decrypt()`. List and get operations return masked data only.
- **Storing plaintext in logs:** Ensure pino serializers do not log request bodies containing `secret` field. Add a `redact` path to pino config if needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting | Custom counter/timer | express-rate-limit with keyGenerator | Handles window sliding, header standards, edge cases |
| Encryption | Custom AES implementation | Existing src/lib/crypto.ts | Already tested, uses HKDF key derivation, supports key versioning |
| Input validation | Manual checks | Zod schemas | Type inference, consistent error format, already used everywhere |
| Access control | Custom permission checks | Existing checkCredentialAccess | Already handles SUPER_ADMIN/MANAGER bypass + permission hierarchy |

**Key insight:** Almost all infrastructure for this phase already exists. The crypto module, access control middleware, Prisma schema, and module conventions are all established. This phase is primarily wiring existing pieces together with a new service layer.

## Common Pitfalls

### Pitfall 1: Leaking Encrypted Fields in Responses
**What goes wrong:** Using `prisma.credential.findMany()` without a `select` clause returns ALL columns including encryptedValue, iv, authTag.
**Why it happens:** Prisma returns all fields by default. A developer forgets to use SAFE_CREDENTIAL_SELECT.
**How to avoid:** Define SAFE_CREDENTIAL_SELECT once and use it in every query. Never use `include` without `select` on the Credential model. Add a test that verifies no response body contains `encryptedValue`.
**Warning signs:** Response payloads contain base64-encoded strings for credential fields.

### Pitfall 2: Update Overwrites Encrypted Fields Unintentionally
**What goes wrong:** An update to friendlyName accidentally nulls out encryptedValue because the update payload doesn't include it.
**Why it happens:** Using spread operators or passing full objects to Prisma update.
**How to avoid:** Build update data object explicitly. Only include fields the user is actually changing. If the user provides a new secret, re-encrypt it. If not, don't touch encrypted fields.
**Warning signs:** Credentials lose their secret after an edit of the name.

### Pitfall 3: Rate Limiter Uses IP Instead of User ID
**What goes wrong:** Multiple users behind the same NAT get collectively rate-limited, while a single user with multiple IPs bypasses limits.
**Why it happens:** express-rate-limit defaults to IP-based keying.
**How to avoid:** Set `keyGenerator: (req) => req.user!.id` explicitly. The reveal endpoint requires authentication, so req.user is always present.
**Warning signs:** Shared office users can't reveal credentials; VPN user can reveal unlimited times.

### Pitfall 4: Missing Access Check Before Reveal
**What goes wrong:** Any authenticated user can reveal any credential by guessing the ID.
**Why it happens:** Forgetting to call `checkCredentialAccess` before the reveal logic.
**How to avoid:** The reveal endpoint must call `checkCredentialAccess(userId, userRole, credentialId, 'VIEW')` before decrypting.
**Warning signs:** A MEMBER can reveal credentials they don't have access to.

### Pitfall 5: Rate Limiter Runs Before Authentication
**What goes wrong:** Rate limiter can't access `req.user.id` because authenticate middleware hasn't run yet.
**Why it happens:** Middleware ordering error in routes.ts.
**How to avoid:** Order: authenticate -> revealRateLimiter -> checkAccess -> controller. The rate limiter MUST come after authenticate.
**Warning signs:** TypeError: Cannot read properties of undefined (reading 'id').

### Pitfall 6: In-Memory Rate Limit State Lost on Restart
**What goes wrong:** Container restart resets all rate limit counters. Not a security disaster but allows brief burst after deploy.
**Why it happens:** express-rate-limit uses in-memory store by default.
**How to avoid:** Accept this for single-container Coolify MVP. Document that Redis store can be added later if needed. The audit log provides forensic evidence regardless.
**Warning signs:** Rate limits reset after every deployment.

### Pitfall 7: Secret Field in Request Body Gets Logged
**What goes wrong:** pino-http logs request bodies, exposing plaintext secrets in logs.
**Why it happens:** Default pino-http configuration logs everything.
**How to avoid:** Add `redact` paths to pino config: `['req.body.secret']`. Or better, ensure pino-http is not configured to log request bodies (check current config -- it likely doesn't log bodies by default, but verify).
**Warning signs:** Plaintext secrets appear in application logs.

## Code Examples

### Credential Validation Schemas
```typescript
// credentials.validation.ts
import { z } from 'zod';

export const createCredentialSchema = z.object({
  friendlyName: z.string().min(1).max(255),
  systemHost: z.string().max(255).optional(),
  username: z.string().max(255).optional(),
  secret: z.string().min(1).max(10000),
  expiresAt: z.coerce.date().optional(),
});

export const updateCredentialSchema = z.object({
  friendlyName: z.string().min(1).max(255).optional(),
  systemHost: z.string().max(255).nullable().optional(),
  username: z.string().max(255).nullable().optional(),
  secret: z.string().min(1).max(10000).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;
```

### Route Registration
```typescript
// credentials.routes.ts
import { Router } from 'express';
import * as controller from './credentials.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { revealRateLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

// Create
router.post('/api/credentials', authenticate, controller.create);

// List (user's accessible credentials)
router.get('/api/credentials', authenticate, controller.list);

// Get single
router.get('/api/credentials/:id', authenticate, controller.getOne);

// Reveal secret (rate-limited, audit-logged)
router.post('/api/credentials/:id/reveal', authenticate, revealRateLimiter, controller.reveal);

// Update
router.patch('/api/credentials/:id', authenticate, controller.update);

// Delete (soft)
router.delete('/api/credentials/:id', authenticate, controller.remove);

export { router as credentialRoutes };
```

### Controller Pattern (thin)
```typescript
// credentials.controller.ts - reveal example
export async function reveal(req: Request, res: Response): Promise<void> {
  const credentialId = req.params.id as string;
  await checkCredentialAccess(req.user!.id, req.user!.role, credentialId, 'VIEW');
  const result = await revealCredential(
    credentialId,
    req.user!.id,
    req.ip,
    req.headers['user-agent'] as string | undefined,
  );
  res.status(200).json(result);
}
```

### Update with Optional Secret Re-encryption
```typescript
export async function updateCredential(
  credentialId: string,
  input: UpdateCredentialInput,
) {
  const data: Record<string, unknown> = {};

  if (input.friendlyName !== undefined) data.friendlyName = input.friendlyName;
  if (input.systemHost !== undefined) data.systemHost = input.systemHost;
  if (input.username !== undefined) data.username = input.username;
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;

  // Re-encrypt only if new secret provided
  if (input.secret !== undefined) {
    const encrypted = encrypt(input.secret);
    data.encryptedValue = encrypted.encryptedValue;
    data.iv = encrypted.iv;
    data.authTag = encrypted.authTag;
    data.keyVersion = encrypted.keyVersion;
  }

  const credential = await prisma.credential.update({
    where: { id: credentialId },
    data,
    select: SAFE_CREDENTIAL_SELECT,
  });

  return credential;
}
```

### List Credentials (User's Accessible)
```typescript
export async function listCredentials(userId: string, userRole: string) {
  // SUPER_ADMIN and MANAGER see all; others see only their granted credentials
  const where = (userRole === 'SUPER_ADMIN' || userRole === 'MANAGER')
    ? { deletedAt: null }
    : {
        deletedAt: null,
        credentialAccess: { some: { userId } },
      };

  return prisma.credential.findMany({
    where,
    select: SAFE_CREDENTIAL_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}
```

## API Endpoints Summary

| Method | Path | Auth | Rate Limit | Access Check | Description |
|--------|------|------|------------|--------------|-------------|
| POST | /api/credentials | Yes | No | Creator auto-granted MANAGE | Create credential |
| GET | /api/credentials | Yes | No | Filtered by access | List accessible credentials |
| GET | /api/credentials/:id | Yes | No | VIEW required | Get single (masked) |
| POST | /api/credentials/:id/reveal | Yes | 10/min/user | VIEW required | Decrypt and return secret |
| PATCH | /api/credentials/:id | Yes | No | EDIT required | Update credential |
| DELETE | /api/credentials/:id | Yes | No | MANAGE required | Soft delete |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate encrypt key per credential | HKDF-derived DEK from master key with versioning | Already implemented | Simpler key management, rotation via version bump |
| express-rate-limit <7 | express-rate-limit 8.x | 2024 | ESM-native, standardHeaders 'draft-7', simplified API |

## Open Questions

1. **Pagination for credential list**
   - What we know: Users service uses page/limit offset pagination. Credential list needs similar.
   - What's unclear: Whether to add pagination now or defer. For MVP with small teams, unpaginated list may suffice.
   - Recommendation: Add page/limit pagination matching users.service.ts pattern. Low effort, prevents issues at scale.

2. **Audit logging scope**
   - What we know: CRED-04 requires audit logging on reveal. The AuditLog model exists but no audit service exists yet.
   - What's unclear: Whether to audit create/update/delete as well (not explicitly required but good practice).
   - Recommendation: Build a generic audit service. Audit reveal (required). Optionally audit create/update/delete -- planner can decide scope.

3. **Pino request body redaction**
   - What we know: pino-http by default does NOT log request bodies (only URL, method, status). So plaintext secrets in POST bodies are not logged by default.
   - What's unclear: Whether custom serializers have been added.
   - Recommendation: Verify no body logging exists. If it does, add `redact: ['req.body.secret']`.

## Sources

### Primary (HIGH confidence)
- `src/lib/crypto.ts` -- AES-256-GCM encrypt/decrypt implementation, verified working with tests
- `prisma/schema.prisma` -- Credential model with all required fields already defined
- `src/middleware/requireResourceAccess.ts` -- checkCredentialAccess with permission hierarchy
- `src/modules/credential-access/credential-access.service.ts` -- grantCredentialAccess for auto-grant
- `src/modules/users/users.service.ts` -- SAFE_USER_SELECT pattern reference
- `.planning/research/STACK.md` -- express-rate-limit ^8.6 as planned dependency

### Secondary (MEDIUM confidence)
- express-rate-limit npm page -- v8.6.1, keyGenerator API for per-user limiting
- `.planning/research/FEATURES.md` -- reveal as POST, rate limit specs
- `.planning/research/PITFALLS.md` -- logging, restart state loss

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed or explicitly planned
- Architecture: HIGH -- follows established module conventions exactly
- Pitfalls: HIGH -- derived from codebase analysis and existing planning docs
- Rate limiting: MEDIUM -- express-rate-limit keyGenerator verified via npm docs, in-memory store limitation accepted for MVP

**Research date:** 2026-07-30
**Valid until:** 2026-08-30 (stable domain, no fast-moving dependencies)
