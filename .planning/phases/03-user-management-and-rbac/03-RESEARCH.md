# Phase 3: User Management & RBAC - Research

**Researched:** 2026-07-29
**Domain:** User management, role-based access control, invite flow
**Confidence:** HIGH

## Summary

Phase 3 adds user management (invite, deactivate, role update) and RBAC enforcement to the existing Express 5 + Prisma 6 + TypeScript codebase. The codebase already has: authenticate middleware (JWT Bearer), password hashing (Argon2id), email service (nodemailer), token hashing (SHA-256), session management, and a well-established module pattern (validation.ts -> service.ts -> controller.ts -> routes.ts).

This phase requires: (1) a Prisma schema migration adding `mustChangePassword`, `inviteTokenHash`, and `inviteTokenExpiry` fields to User, (2) a `requireRole` middleware, (3) a new `users` module with invite/deactivate/role-update/password-change endpoints, (4) modifications to the login response to include `mustChangePassword`, and (5) a new `ConflictError` class for the 409 last-SUPER_ADMIN safeguard.

**Primary recommendation:** Follow the existing module pattern exactly. The `requireRole` middleware is a simple function returning Express middleware that checks `req.user.role` against an allowed list with SUPER_ADMIN auto-pass. All other patterns (token hashing, email sending, password verification, session cleanup) already exist and should be reused directly.

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| express | ^5.2.1 | HTTP framework | Already in use |
| @prisma/client | ^6.19.3 | ORM / database access | Already in use |
| zod | ^4.4.3 | Request validation | Already in use |
| @node-rs/argon2 | ^2.0.2 | Password hashing/verification | Already in use |
| nodemailer | ^9.0.3 | Email sending | Already in use |
| jose | ^6.2.4 | JWT sign/verify | Already in use |

### Supporting (already installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| supertest | ^7.2.2 | HTTP integration tests | Already in use |
| vitest | ^4.1.10 | Test runner | Already in use |

### No new dependencies needed
This phase requires zero new npm packages. Everything is built on top of existing infrastructure.

## Architecture Patterns

### Module Structure (follow existing pattern exactly)
```
src/
├── middleware/
│   ├── authenticate.ts          # EXISTS - JWT verification
│   └── requireRole.ts           # NEW - role-based access middleware
├── modules/
│   └── users/
│       ├── users.validation.ts  # NEW - Zod schemas
│       ├── users.service.ts     # NEW - business logic
│       ├── users.controller.ts  # NEW - thin controllers
│       ├── users.routes.ts      # NEW - route definitions
│       └── users.test.ts        # NEW - integration tests
├── services/
│   ├── email.service.ts         # MODIFY - add sendInviteEmail
│   ├── password.service.ts      # EXISTS - reuse verifyPassword, hashPassword
│   └── token.service.ts         # MODIFY - add generateInviteToken
├── lib/
│   └── errors.ts                # MODIFY - add ConflictError
└── modules/auth/
    └── auth.service.ts          # MODIFY - loginUser returns mustChangePassword
```

### Pattern 1: requireRole Middleware
**What:** A middleware factory that returns Express middleware checking the user's role against allowed roles, with SUPER_ADMIN auto-pass.
**When to use:** On every protected route after `authenticate`.

```typescript
// src/middleware/requireRole.ts
import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../lib/errors.js';
import type { Role } from '@prisma/client';

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userRole = req.user?.role as Role | undefined;

    if (!userRole) {
      throw new ForbiddenError();
    }

    // SUPER_ADMIN always passes all role checks
    if (userRole === 'SUPER_ADMIN') {
      next();
      return;
    }

    if (!allowedRoles.includes(userRole)) {
      throw new ForbiddenError();
    }

    next();
  };
}
```

**Key details:**
- ForbiddenError already returns 403 with no reason disclosed (message is just "Forbidden")
- Uses the Role enum from Prisma for type safety
- Must be placed AFTER `authenticate` in the middleware chain
- Express 5 automatically catches thrown errors in async/sync middleware

### Pattern 2: Route Declaration with Role Enforcement
**What:** Each route explicitly declares which roles are allowed.

```typescript
// src/modules/users/users.routes.ts
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import * as usersController from './users.controller.js';

const router = Router();

// SUPER_ADMIN-only endpoints
router.post('/api/users/invite', authenticate, requireRole('SUPER_ADMIN'), usersController.invite);
router.get('/api/users', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), usersController.list);
router.patch('/api/users/:id', authenticate, requireRole('SUPER_ADMIN'), usersController.update);
router.post('/api/users/:id/deactivate', authenticate, requireRole('SUPER_ADMIN'), usersController.deactivate);
router.post('/api/users/:id/resend-invite', authenticate, requireRole('SUPER_ADMIN'), usersController.resendInvite);

// Self-service (any authenticated user)
router.post('/api/users/me/password', authenticate, usersController.changePassword);

export { router as userRoutes };
```

### Pattern 3: Thin Controller (follow existing auth.controller.ts)
```typescript
export async function invite(req: Request, res: Response): Promise<void> {
  const data = parseBody(inviteSchema, req.body);
  const result = await inviteUser(data, req.user!.id);
  res.status(201).json(result);
}
```

### Pattern 4: Invite Token Generation (reuse existing token patterns)
The codebase already has `generateResetToken` which returns `{ plainToken, hashedToken }`. Create `generateInviteToken` following the exact same pattern in token.service.ts.

### Pattern 5: Temporary Password Generation
```typescript
// In token.service.ts or users.service.ts
import crypto from 'node:crypto';

export function generateTempPassword(): string {
  // 16 random bytes -> base64url = 22 chars, always meets 12-char minimum
  return crypto.randomBytes(16).toString('base64url');
}
```

**Key insight:** The temp password does NOT need to be human-memorable. It's copy-pasted from an email. Use `crypto.randomBytes` for security, base64url encoding for email-safe characters. This is the same `crypto` module already imported in token.service.ts.

### Pattern 6: Last-SUPER_ADMIN Safeguard
```typescript
// In users.service.ts
async function assertNotLastSuperAdmin(userId: string): Promise<void> {
  const count = await prisma.user.count({
    where: {
      role: 'SUPER_ADMIN',
      isActive: true,
      deletedAt: null,
      id: { not: userId },
    },
  });
  if (count === 0) {
    throw new ConflictError('Cannot remove the last active SUPER_ADMIN');
  }
}
```

Use before: deactivating a SUPER_ADMIN, demoting a SUPER_ADMIN's role, or a SUPER_ADMIN demoting themselves.

### Anti-Patterns to Avoid
- **Role hierarchy as numeric levels:** Don't assign numbers (VIEWER=0, MEMBER=1, etc.) and compare with `>=`. Use explicit role lists per route. The decision is clear: `requireRole(...roles)` with explicit declarations.
- **Checking role in service layer:** Role checks happen in middleware, not in service functions. Services receive already-authorized requests.
- **Blocking endpoints for mustChangePassword:** The decision explicitly states this is client-side. Do NOT add middleware that blocks API calls when mustChangePassword is true.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing | Custom hash | `password.service.ts` (Argon2id) | Already exists, tuned for security |
| Token hashing | Custom SHA | `token.service.ts` hashToken | Already exists, consistent pattern |
| Email sending | Direct SMTP | `email.service.ts` getTransporter | Already exists, mockable for tests |
| Session cleanup | Manual SQL | `prisma.session.deleteMany({ where: { userId } })` | Already used in auth.service.ts |
| Error responses | Manual res.status() | Throw AppError subclasses | Error handler catches and formats |
| Request validation | Manual checks | Zod schemas + parseBody pattern | Already established in auth module |

## Common Pitfalls

### Pitfall 1: Express 5 Route Parameter Type
**What goes wrong:** Express 5 changed how route params work. `req.params.id` is still a string but Express 5 route typing may need explicit handling.
**How to avoid:** Always access `req.params.id` as string, which it always is. No parseInt needed for CUID IDs.

### Pitfall 2: Forgetting to Update Login Response
**What goes wrong:** Login endpoint doesn't return `mustChangePassword`, so client never knows to prompt.
**How to avoid:** Modify `loginUser` in `auth.service.ts` to include `mustChangePassword: user.mustChangePassword` in the return object. This is a change to an existing file.

### Pitfall 3: Self-Protection Rules for SUPER_ADMIN
**What goes wrong:** SUPER_ADMIN deactivates themselves or demotes their own role, locking everyone out.
**Rules to enforce:**
- SUPER_ADMIN cannot deactivate themselves (`req.user.id === req.params.id` + deactivation action)
- SUPER_ADMIN cannot demote their own role
- SUPER_ADMIN cannot deactivate/demote another SUPER_ADMIN
- Last-SUPER_ADMIN safeguard: 409 if operation would leave zero active SUPER_ADMINs
**How to avoid:** Check these conditions BEFORE performing the update in the service layer.

### Pitfall 4: Session Cleanup on Deactivation
**What goes wrong:** User is deactivated but their existing JWT access tokens still work until expiry.
**How to avoid:** When deactivating, `prisma.session.deleteMany({ where: { userId } })` removes all refresh tokens. Access tokens still work until they expire (max 15 min per env config), which is acceptable. The refresh will fail because user.isActive is checked during refresh (already implemented in auth.service.ts line 129).

### Pitfall 5: Race Condition on Last-SUPER_ADMIN Check
**What goes wrong:** Two concurrent requests both pass the "not last SUPER_ADMIN" check, then both demote.
**How to avoid:** Use a Prisma transaction with the count check and update together. For this app's scale this is extremely unlikely, but the transaction is trivial to add and prevents it.

### Pitfall 6: ESM Import Extensions
**What goes wrong:** Imports without `.js` extension fail at runtime in ESM mode.
**How to avoid:** Every relative import MUST end in `.js` (e.g., `import { requireRole } from '../../middleware/requireRole.js'`). This is the project convention established in Phase 1.

### Pitfall 7: Invite Token Reuse on Resend
**What goes wrong:** Resending an invite doesn't invalidate the old token, so two valid tokens exist.
**How to avoid:** On resend, generate a new invite token AND new temp password, overwriting the old hashed values. The old token automatically becomes invalid since its hash is overwritten.

### Pitfall 8: ConflictError Class Missing
**What goes wrong:** The 409 status code for last-SUPER_ADMIN safeguard has no error class.
**How to avoid:** Add `ConflictError` to `src/lib/errors.ts`:
```typescript
export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409);
  }
}
```

## Code Examples

### Schema Migration (Prisma)
```prisma
// Add to User model in schema.prisma
model User {
  // ... existing fields ...
  mustChangePassword Boolean   @default(false) @map("must_change_password")
  inviteTokenHash    String?   @map("invite_token_hash")
  inviteTokenExpiry  DateTime? @map("invite_token_expiry")
  // ... rest of fields ...
}
```

### Invite User Service Function
```typescript
export async function inviteUser(data: { email: string; name: string; role: Role }) {
  // Check if email already exists
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw new ConflictError('A user with this email already exists');
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const { plainToken, hashedToken } = generateInviteToken();

  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      role: data.role,
      passwordHash,
      mustChangePassword: true,
      inviteTokenHash: hashedToken,
      inviteTokenExpiry: new Date(Date.now() + inviteTokenExpiryDays * 24 * 60 * 60_000),
    },
  });

  await sendInviteEmail(data.email, tempPassword);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
```

### Change Own Password Service Function
```typescript
export async function changeOwnPassword(
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const valid = await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      mustChangePassword: false,
    },
  });

  // Delete all sessions EXCEPT current one
  await prisma.session.deleteMany({
    where: {
      userId,
      id: { not: currentSessionId },
    },
  });
}
```

### Deactivate User Service Function
```typescript
export async function deactivateUser(
  targetId: string,
  actingUserId: string,
): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id: targetId, deletedAt: null },
  });
  if (!target) throw new NotFoundError('User not found');

  // SUPER_ADMIN cannot deactivate themselves
  if (targetId === actingUserId) {
    throw new ForbiddenError();
  }

  // Cannot deactivate another SUPER_ADMIN
  if (target.role === 'SUPER_ADMIN') {
    throw new ForbiddenError();
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: targetId },
      data: { isActive: false },
    }),
    prisma.session.deleteMany({
      where: { userId: targetId },
    }),
  ]);
}
```

### Invite Email Function
```typescript
// Add to email.service.ts
export async function sendInviteEmail(
  to: string,
  tempPassword: string,
): Promise<void> {
  const loginUrl = `${env.FRONTEND_URL}/login`;

  await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Kick Vault - You Have Been Invited',
    text: `You have been invited to Kick Vault.\n\nYour temporary password: ${tempPassword}\n\nLog in at: ${loginUrl}\n\nYou will be required to change your password on first login.`,
    html: `<p>You have been invited to Kick Vault.</p><p>Your temporary password: <strong>${tempPassword}</strong></p><p><a href="${loginUrl}">Log in here</a></p><p>You will be required to change your password on first login.</p>`,
  });

  logger.info({ to }, 'Invite email sent');
}
```

### Modified Login Response (auth.service.ts)
```typescript
// In loginUser function, modify the return to include:
return {
  accessToken,
  refreshToken,
  expiresIn: env.ACCESS_TOKEN_EXPIRY_MIN * 60,
  mustChangePassword: user.mustChangePassword, // ADD THIS
};
```

### Test Pattern for RBAC
```typescript
describeWithDb('USER-03: RBAC enforcement', () => {
  async function loginAs(role: Role) {
    const email = `${role.toLowerCase()}@kickvault.test`;
    await prisma.user.create({
      data: {
        email,
        name: `${role} User`,
        passwordHash: testPasswordHash,
        role,
      },
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: TEST_PASSWORD });
    return res.body.accessToken as string;
  }

  it('allows SUPER_ADMIN to access admin endpoints', async () => {
    const token = await loginAs('SUPER_ADMIN');
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).not.toBe(403);
  });

  it('forbids VIEWER from accessing admin endpoints', async () => {
    const token = await loginAs('VIEWER');
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });
});
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Role hierarchy with numeric levels | Explicit role lists per route | Clearer, less error-prone |
| Magic link invites | Temp password + mustChangePassword flag | Simpler server, client enforces change |
| Middleware blocks all endpoints when must change | Client-side gating only | Simpler API, pragmatic for internal tool |

## Open Questions

1. **User listing pagination**
   - What we know: SUPER_ADMIN and MANAGER can list users
   - What's unclear: Whether pagination is needed in this phase or deferred
   - Recommendation: Add basic offset/limit pagination to GET /api/users from the start (simple to add, hard to retrofit)

2. **Invite token vs temp password**
   - What we know: Context says invite token (7-day expiry, SHA-256 hashed) AND temp password
   - What's unclear: What the invite token is actually used for, since the user logs in with temp password
   - Recommendation: The invite token may serve as a tracking/validation mechanism. Store it but the primary flow is: user receives temp password, logs in with it, gets mustChangePassword flag. The invite token could be used for a future "accept invite" page. For now, store it on the User model per the decision, but the login flow uses the temp password directly.

3. **GET /api/users response shape**
   - What we know: SUPER_ADMIN needs to manage users
   - What's unclear: Exact fields to return
   - Recommendation: Return `{ id, email, name, role, isActive, mustChangePassword, lastLoginAt, createdAt }` — never return passwordHash or token fields

## Sources

### Primary (HIGH confidence)
- Existing codebase at /Users/patrick/Desktop/kickvault/src — all patterns, services, middleware directly examined
- Prisma schema at /Users/patrick/Desktop/kickvault/prisma/schema.prisma — User model, Session model, Role enum
- CONTEXT.md decisions — all implementation choices locked

### Secondary (MEDIUM confidence)
- Express 5 middleware chaining — verified by examining existing authenticate middleware pattern
- Prisma deleteMany/transaction usage — verified by examining existing auth.service.ts

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, everything already exists in codebase
- Architecture: HIGH - follows exact patterns already established in auth module
- Pitfalls: HIGH - derived from direct codebase analysis and locked decisions
- Code examples: HIGH - based on existing code patterns in the repository

**Research date:** 2026-07-29
**Valid until:** 2026-08-28 (stable domain, no fast-moving dependencies)
