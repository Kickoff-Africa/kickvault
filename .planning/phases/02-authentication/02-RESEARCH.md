# Phase 2: Authentication - Research

**Researched:** 2026-07-29
**Domain:** JWT authentication, password hashing, session management, password reset
**Confidence:** HIGH

## Summary

This phase implements email/password authentication with JWT access + refresh token pairs, DB-backed sessions with sliding window inactivity timeout, brute-force protection via account lockout, and password reset via email. The tech stack is already decided: `jose` for JWT, `@node-rs/argon2` for password hashing, and `nodemailer` for email delivery.

The architecture is a hybrid approach: short-lived access tokens (stateless JWTs, 15 min) paired with long-lived refresh tokens (stored in the Session table, 7 days). Session revocation works by deleting Session rows. The `lastActiveAt` field on Session implements sliding window inactivity timeout, updated on each authenticated request with a threshold to avoid excessive DB writes.

**Primary recommendation:** Use a service-layer architecture (`src/modules/auth/`) with a clean separation between route handlers, auth service (business logic), token service (JWT operations), and password service (hashing). Keep middleware thin -- authenticate middleware only verifies the access token and attaches the user to the request.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| jose | ^6.x | JWT sign/verify (JWS) | Zero-dependency, Web Crypto API, maintained by OIDC spec author, ESM-native |
| @node-rs/argon2 | ^2.x | Argon2id password hashing | Native Rust binding via NAPI-RS, 2x faster than C++ bindings, zero config |
| nodemailer | ^6.x | SMTP email transport | 5M+ weekly downloads, universal SMTP client, Ethereal for testing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| crypto (Node built-in) | -- | Secure token generation | Password reset tokens via `crypto.randomBytes()` |
| zod | ^4.x (already installed) | Request validation | Validate login, register, reset-password request bodies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nodemailer | resend SDK | Resend has better deliverability out of box, but requires vendor lock-in and paid plan at scale. Nodemailer works with any SMTP (Coolify can run Mailpit/SMTP relay). Use nodemailer for self-hosted flexibility. |
| jose | jsonwebtoken | jsonwebtoken has callback API, no ESM support, abandoned maintenance. jose is actively maintained by the same author. |

**Installation:**
```bash
npm install jose @node-rs/argon2 nodemailer
npm install -D @types/nodemailer
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── modules/
│   └── auth/
│       ├── auth.routes.ts        # Express router with route definitions
│       ├── auth.controller.ts    # Request/response handling, calls service
│       ├── auth.service.ts       # Business logic (login, logout, refresh, reset)
│       ├── auth.validation.ts    # Zod schemas for request bodies
│       └── auth.test.ts          # Integration tests
├── services/
│   ├── token.service.ts          # JWT sign/verify, token creation
│   ├── password.service.ts       # Argon2 hash/verify wrapper
│   └── email.service.ts          # Nodemailer transport, sendResetEmail
├── middleware/
│   ├── errorHandler.ts           # (exists)
│   └── authenticate.ts           # JWT verification middleware
├── config/
│   ├── env.ts                    # (exists, extend with new vars)
│   └── database.ts               # (exists)
└── types/
    └── express.d.ts              # Extend Express Request with user/session
```

### Pattern 1: JWT Access + Refresh Token Pair

**What:** Access tokens are short-lived JWTs (15 min) carrying user ID and role. Refresh tokens are opaque identifiers stored in the Session table. On access token expiry, client sends refresh token to get a new access + refresh pair.

**When to use:** Every authenticated endpoint.

**Example:**
```typescript
// src/services/token.service.ts
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

interface AccessTokenPayload extends JWTPayload {
  sub: string;       // user ID
  role: string;      // user role
  sessionId: string; // session ID for activity tracking
}

const secret = new TextEncoder().encode(env.JWT_SECRET);

export async function signAccessToken(payload: {
  userId: string;
  role: string;
  sessionId: string;
}): Promise<string> {
  return new SignJWT({
    role: payload.role,
    sessionId: payload.sessionId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_EXPIRY_MIN}m`)
    .setIssuer('kickvault')
    .sign(secret);
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: 'kickvault',
    algorithms: ['HS256'],
  });
  return payload as AccessTokenPayload;
}
```

### Pattern 2: Refresh Token as Opaque String in Session Table

**What:** Refresh tokens are NOT JWTs. They are cryptographically random strings stored in the Session table. This makes revocation instant (delete the row) and avoids JWT pitfalls for long-lived tokens.

**Example:**
```typescript
import crypto from 'node:crypto';

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// On login: create Session row with refreshToken, expiresAt, userId
// On refresh: find Session by refreshToken, verify not expired,
//             delete old session, create new session + new tokens
// On logout: delete Session row(s)
```

### Pattern 3: Authenticate Middleware

**What:** Express middleware that extracts Bearer token from Authorization header, verifies the JWT, loads user context, and attaches to `req`.

**Example:**
```typescript
// src/middleware/authenticate.ts
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/token.service.js';
import { UnauthorizedError } from '../lib/errors.js';
import { prisma } from '../config/database.js';

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing access token');
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyAccessToken(token);

    // Update session lastActiveAt (with threshold)
    const now = new Date();
    await prisma.session.updateMany({
      where: {
        id: payload.sessionId,
        // Only update if last active > threshold ago (e.g., 1 minute)
        lastActiveAt: { lt: new Date(now.getTime() - 60_000) },
      },
      data: { lastActiveAt: now },
    });

    req.user = { id: payload.sub!, role: payload.role };
    req.sessionId = payload.sessionId;
    next();
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }
}
```

### Pattern 4: Account Lockout Logic

**What:** Track failed login attempts in the DB. Lock account after threshold. Auto-unlock after lockout period.

**Example:**
```typescript
// Inside auth.service.ts login flow
async function handleFailedLogin(user: User): Promise<void> {
  const attempts = user.failedAttempts + 1;

  if (attempts >= 5) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: attempts,
        lockedUntil: new Date(Date.now() + 15 * 60 * 1000), // 15 min lockout
      },
    });
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: attempts },
    });
  }
}

function isAccountLocked(user: User): boolean {
  return user.lockedUntil !== null && user.lockedUntil > new Date();
}

// On successful login: reset failedAttempts to 0, clear lockedUntil
```

### Anti-Patterns to Avoid
- **Storing access tokens in DB:** Access tokens are stateless JWTs. Only refresh tokens go in the Session table.
- **Using JWT for refresh tokens:** JWTs can't be revoked without a blocklist. Use opaque tokens stored in DB.
- **Updating lastActiveAt on every request without threshold:** Causes N DB writes per N requests. Use a 1-minute threshold.
- **Checking session validity on every request:** The access token IS the session check (it's short-lived). Only check the Session table on refresh.
- **Storing password reset tokens in plaintext:** Hash them with SHA-256 before storing. Compare hashes on verification.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing | Custom bcrypt/scrypt wrapper | `@node-rs/argon2` with Argon2id | Argon2id is OWASP's top recommendation, resistant to GPU/ASIC attacks |
| JWT creation/verification | Manual base64 + HMAC | `jose` SignJWT/jwtVerify | Handles all edge cases: clock skew, algorithm confusion, claim validation |
| Secure random tokens | `Math.random()` or UUID | `crypto.randomBytes(32)` | Cryptographically secure, unpredictable |
| Email transport | Raw SMTP socket | `nodemailer` | Handles encoding, attachments, connection pooling, auth |
| Request validation | Manual if/else checks | `zod` schemas | Already in project, type-safe, composable |

**Key insight:** Authentication is the highest-risk code in any application. Every component should use battle-tested libraries. Even "simple" operations like comparing tokens must use constant-time comparison (`crypto.timingSafeEqual`).

## Common Pitfalls

### Pitfall 1: JWT Secret Too Short
**What goes wrong:** HS256 requires a 256-bit secret. Short secrets are brute-forceable.
**Why it happens:** Developers use human-readable strings like "mysecret".
**How to avoid:** Generate with `openssl rand -hex 32` (produces 64 hex chars = 256 bits). Validate length in env schema.
**Warning signs:** JWT_SECRET shorter than 32 bytes.

### Pitfall 2: Refresh Token Reuse Detection Missing
**What goes wrong:** Stolen refresh token is used after legitimate user has already rotated it.
**Why it happens:** No tracking of token reuse.
**How to avoid:** On refresh, delete the old Session row and create a new one (rotate). If a deleted token is presented, it means theft -- invalidate ALL user sessions.
**Warning signs:** Refresh endpoint that only returns new access token without rotating the refresh token.

### Pitfall 3: Race Condition on Account Lockout
**What goes wrong:** Concurrent requests bypass the failed attempt counter.
**Why it happens:** Read-then-write without atomic operation.
**How to avoid:** Use Prisma's atomic `increment` operation: `prisma.user.update({ data: { failedAttempts: { increment: 1 } } })`.
**Warning signs:** `failedAttempts = user.failedAttempts + 1` in application code.

### Pitfall 4: Password Reset Token Timing Attack
**What goes wrong:** Attacker determines valid tokens via response time differences.
**Why it happens:** Early return when token not found vs hash comparison.
**How to avoid:** Always perform the same operations regardless of token validity. Use constant-time comparison for hashed tokens.
**Warning signs:** Different error messages for "token not found" vs "token expired".

### Pitfall 5: Session Expiry Not Checked on Refresh
**What goes wrong:** Expired sessions still grant new access tokens.
**Why it happens:** Only checking `expiresAt` but not `lastActiveAt` + inactivity timeout.
**How to avoid:** On refresh, check BOTH `session.expiresAt > now` AND `session.lastActiveAt > now - INACTIVE_SESSION_TIMEOUT`.
**Warning signs:** Refresh endpoint that only checks one expiry condition.

### Pitfall 6: Email Enumeration on Forgot Password
**What goes wrong:** Attacker discovers which emails are registered.
**Why it happens:** Different responses for "email found" vs "email not found".
**How to avoid:** Always return the same success response: "If an account exists, a reset email has been sent." Always take the same amount of time.
**Warning signs:** 404 or specific error for unregistered emails.

## Code Examples

### Argon2id Password Hashing
```typescript
// src/services/password.service.ts
import { hash, verify } from '@node-rs/argon2';

// OWASP recommended Argon2id parameters
const HASH_OPTIONS = {
  memoryCost: 19456,  // 19 MiB (OWASP minimum recommendation)
  timeCost: 2,        // 2 iterations
  parallelism: 1,     // 1 thread
};

// For test environment, use faster params
const TEST_OPTIONS = {
  memoryCost: 1024,   // 1 MiB
  timeCost: 1,
  parallelism: 1,
};

const options = process.env.NODE_ENV === 'test' ? TEST_OPTIONS : HASH_OPTIONS;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  return verify(hash, password, options);
}
```

### Password Reset Token Generation and Storage
```typescript
// src/services/token.service.ts (additions)
import crypto from 'node:crypto';

export function generateResetToken(): {
  plainToken: string;
  hashedToken: string;
} {
  // Generate 32 random bytes, encode as URL-safe base64
  const plainToken = crypto.randomBytes(32).toString('base64url');
  // Store the SHA-256 hash, not the plaintext
  const hashedToken = crypto
    .createHash('sha256')
    .update(plainToken)
    .digest('hex');
  return { plainToken, hashedToken };
}

export function hashResetToken(plainToken: string): string {
  return crypto
    .createHash('sha256')
    .update(plainToken)
    .digest('hex');
}
```

### Email Service with Testability
```typescript
// src/services/email.service.ts
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let transporter: Transporter;

export function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

// For testing: inject a mock transporter
export function setTransporter(mock: Transporter): void {
  transporter = mock;
}

export async function sendPasswordResetEmail(
  to: string,
  resetToken: string,
): Promise<void> {
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  const info = await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Password Reset - Kick Vault',
    html: `
      <p>You requested a password reset.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires in 15 minutes.</p>
      <p>If you didn't request this, ignore this email.</p>
    `,
  });

  logger.info({ messageId: info.messageId }, 'Password reset email sent');
}
```

### Env Schema Additions
```typescript
// Additions to src/config/env.ts
const envSchema = z.object({
  // ... existing fields ...

  // JWT
  JWT_SECRET: z
    .string()
    .min(32, 'JWT secret must be at least 32 characters'),
  ACCESS_TOKEN_EXPIRY_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_EXPIRY_DAYS: z.coerce.number().int().positive().default(7),

  // Session
  INACTIVE_SESSION_TIMEOUT_MIN: z.coerce.number().int().positive().default(15),

  // SMTP
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().email().default('noreply@kickvault.local'),

  // Frontend
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
});
```

### Request Type Augmentation
```typescript
// src/types/express.d.ts
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
      };
      sessionId?: string;
    }
  }
}
export {};
```

### Login Flow (Complete)
```typescript
// src/modules/auth/auth.service.ts (login excerpt)
export async function login(dto: LoginDto, meta: RequestMeta) {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });

  if (!user || !user.isActive) {
    throw new UnauthorizedError('Invalid email or password');
  }

  if (isAccountLocked(user)) {
    throw new ForbiddenError('Account is locked. Try again later.');
  }

  const valid = await verifyPassword(user.passwordHash, dto.password);

  if (!valid) {
    await handleFailedLogin(user);
    throw new UnauthorizedError('Invalid email or password');
  }

  // Reset failed attempts on success
  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  // Create session
  const refreshToken = generateRefreshToken();
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      expiresAt: new Date(
        Date.now() + env.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      ),
    },
  });

  const accessToken = await signAccessToken({
    userId: user.id,
    role: user.role,
    sessionId: session.id,
  });

  return { accessToken, refreshToken };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| jsonwebtoken (callback API) | jose (async/await, Web Crypto) | jose v4+ (2022) | Better DX, ESM support, no deprecated deps |
| bcrypt for passwords | Argon2id | OWASP 2023+ recommendation | Memory-hard, GPU-resistant, better security profile |
| Stateless JWT refresh tokens | DB-backed refresh tokens | Industry consensus ~2020 | Enables instant revocation, no blocklist needed |
| Store reset tokens plain | Store SHA-256 hash of token | OWASP guidance | Defense-in-depth: DB breach doesn't leak valid tokens |

**Deprecated/outdated:**
- `jsonwebtoken`: No ESM support, callback API, maintenance concerns
- `bcrypt`/`bcryptjs`: Argon2id is now the OWASP top recommendation
- Stateless refresh tokens: Can't be revoked without a blocklist, which is just a session table with extra steps

## Password Reset: Schema Addition Needed

The Prisma schema needs a model (or fields on User) to store password reset tokens. Two approaches:

**Option A: Fields on User model (simpler, recommended)**
```prisma
model User {
  // ... existing fields ...
  resetTokenHash  String?   @map("reset_token_hash")
  resetTokenExpiry DateTime? @map("reset_token_expiry")
}
```

**Option B: Separate PasswordReset model (more flexible)**
```prisma
model PasswordReset {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  tokenHash String   @map("token_hash")
  expiresAt DateTime @map("expires_at")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tokenHash])
  @@index([userId])
  @@map("password_resets")
}
```

**Recommendation:** Option A (fields on User). Simpler, only one active reset token per user (inherently single-use), and avoids an extra table. When a new reset is requested, overwrite the old token. When used, null both fields.

## Session Sliding Window: Threshold Strategy

Updating `lastActiveAt` on every authenticated request causes excessive DB writes. Use a **1-minute threshold**:

```typescript
// Only update if last activity was > 1 minute ago
const ACTIVITY_THRESHOLD_MS = 60_000; // 1 minute

// In authenticate middleware:
const timeSinceActive = now.getTime() - session.lastActiveAt.getTime();
if (timeSinceActive > ACTIVITY_THRESHOLD_MS) {
  // Fire-and-forget update (don't await, don't block the request)
  prisma.session.update({
    where: { id: sessionId },
    data: { lastActiveAt: now },
  }).catch((err) => logger.error(err, 'Failed to update session activity'));
}
```

**Key design decision:** The authenticate middleware does NOT query the Session table on every request. It only verifies the access token JWT (stateless). The `lastActiveAt` update uses `updateMany` with a `where` clause that includes a time threshold, so no read is needed -- the DB handles the conditional update atomically.

The inactivity check happens on the **refresh endpoint**, not on every request. When the client's access token expires (15 min) and it tries to refresh, the server checks `session.lastActiveAt + INACTIVE_SESSION_TIMEOUT > now`. If the session is inactive, the refresh is rejected.

## Route Structure

```
POST /api/auth/login          # Email + password -> access + refresh tokens
POST /api/auth/logout         # Invalidate current session (requires auth)
POST /api/auth/refresh        # Refresh token -> new access + refresh tokens
POST /api/auth/forgot-password # Email -> sends reset email (no auth required)
POST /api/auth/reset-password  # Token + new password -> resets password (no auth)
```

All routes under `/api/auth/` prefix. No auth required for login, forgot-password, reset-password. Auth required for logout.

## Testing Strategy

### Unit Tests
- **token.service.ts:** Test sign/verify round-trip, expired token rejection, invalid signature rejection
- **password.service.ts:** Test hash/verify round-trip, wrong password rejection (use TEST_OPTIONS for speed)
- **auth.service.ts:** Test login flow (mock prisma + password service), lockout logic, session creation

### Integration Tests
- **auth.routes.ts:** Supertest against Express app with test database
- Test full login/logout/refresh/forgot-password/reset-password flows
- Test lockout after 5 failed attempts
- Test session expiry behavior

### Email Testing
```typescript
// In tests, mock the email service
import { vi } from 'vitest';

// Option 1: Mock the email service module
vi.mock('../services/email.service.js', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

// Option 2: Use nodemailer's createTestAccount for integration tests
import nodemailer from 'nodemailer';
const testAccount = await nodemailer.createTestAccount();
const testTransporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  auth: { user: testAccount.user, pass: testAccount.pass },
});
```

### What to Test for Each Requirement
| Requirement | Key Test Cases |
|-------------|---------------|
| AUTH-01 | Valid login returns tokens, invalid password returns 401, inactive user rejected |
| AUTH-02 | 5th failed attempt locks account, locked account returns 403, auto-unlock after period |
| AUTH-03 | Refresh after inactivity timeout is rejected, active session refresh succeeds |
| AUTH-04 | Logout deletes session, refresh with deleted session returns 401 |
| AUTH-05 | Forgot-password sends email, reset with valid token changes password, expired/used token rejected |

## Open Questions

1. **Account lockout duration**
   - What we know: Lock after 5 failed attempts (from requirements)
   - What's unclear: How long should the lockout last? 15 minutes is standard.
   - Recommendation: Default to 15 minutes, make configurable via `ACCOUNT_LOCKOUT_DURATION_MIN` env var.

2. **Password reset token expiry**
   - What we know: Should be short-lived (OWASP says "appropriate period")
   - What's unclear: Exact duration not specified in requirements
   - Recommendation: 15 minutes, configurable via `RESET_TOKEN_EXPIRY_MIN` env var.

3. **Refresh token rotation on refresh**
   - What we know: Best practice is to rotate (issue new refresh token on each refresh)
   - What's unclear: Whether to implement reuse detection (invalidate all sessions if old token reused)
   - Recommendation: Implement rotation. Defer reuse detection to Phase 3 (force-logout exists there).

4. **SMTP in development/test**
   - What we know: Production needs real SMTP. Tests mock the service.
   - What's unclear: What to use for local development
   - Recommendation: Use Ethereal (nodemailer's test service) in development, or Mailpit via Docker Compose.

## Sources

### Primary (HIGH confidence)
- [jose GitHub - SignJWT API](https://github.com/panva/jose/blob/main/docs/jwt/sign/classes/SignJWT.md) - Full class API with method signatures
- [jose GitHub - jwtVerify API](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md) - Verify function signatures and options
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) - Argon2id parameters: m=19456, t=2, p=1
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) - Token generation, storage, single-use enforcement
- [@node-rs/argon2 npm](https://www.npmjs.com/package/@node-rs/argon2) - hash/verify API, options interface

### Secondary (MEDIUM confidence)
- [Nodemailer testing with Ethereal](https://nodemailer.com/guides/testing-with-ethereal) - Test account creation, preview URLs
- [nodemailer-mock](https://github.com/doublesharp/nodemailer-mock) - Mock library for unit testing

### Tertiary (LOW confidence)
- Session sliding window threshold approach - derived from general patterns, no single authoritative source

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified via official docs and npm
- Architecture: HIGH - Follows well-established JWT + DB session patterns
- Argon2id parameters: HIGH - Directly from OWASP cheat sheet
- Password reset flow: HIGH - OWASP guidance verified
- Session sliding window threshold: MEDIUM - Common pattern but no canonical implementation
- Pitfalls: HIGH - Well-documented in security community

**Research date:** 2026-07-29
**Valid until:** 2026-08-28 (stable domain, 30 days)
