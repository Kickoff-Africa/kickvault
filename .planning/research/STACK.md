# Stack Research: Kick Vault

> Research date: 2026-07-29
> Core stack (decided): Node.js + TypeScript + Express + Prisma ORM + PostgreSQL
> Deployment target: Docker container on Coolify (self-hosted)

---

## Recommended Libraries

### Authentication -- JWT

**Choice:** `jose@^6.2`
**Rationale:** jose is the modern standard for JWT in Node.js (76M weekly downloads, 1.8x more than jsonwebtoken). It uses the Web Crypto API, ships full ESM support, handles JWS + JWE + JWKS, and is maintained by the author of the OAuth/OIDC specifications. It is the default in Auth.js and Hono. For a credential vault that may need token encryption (JWE) or key rotation via JWKS, jose covers every requirement out of the box.
**Confidence:** High
**Avoid:** `jsonwebtoken` -- legacy API, Node.js-only, no JWE support, no JWKS rotation, synchronous design. Still receives downloads but almost entirely from existing codebases, not new projects.

### Password Hashing

**Choice:** `@node-rs/argon2@^2.0` (Argon2id)
**Rationale:** Argon2id is the OWASP/NIST recommended password hashing algorithm for new applications. The `@node-rs/argon2` package is a native Rust binding via NAPI-RS -- dramatically faster than pure-JS implementations while remaining easy to install. Argon2id is memory-hard, resisting GPU/ASIC attacks that bcrypt is increasingly vulnerable to. Recommended starting parameters: `m=65536 (64 MB), t=3, p=4`.
**Confidence:** High
**Avoid:** `bcrypt` / `bcryptjs` -- limited to 72-byte passwords, designed in 1999, increasingly vulnerable to GPU farm attacks. Still safe at cost >= 12, but there is no reason to choose it for a greenfield project. Also avoid pure-JS argon2 implementations (e.g., `hash-wasm`) -- they are orders of magnitude slower and force weaker parameters.

### Encryption (Credential Vault)

**Choice:** Node.js built-in `node:crypto` module -- AES-256-GCM
**Rationale:** The `node:crypto` module provides battle-tested, OpenSSL-backed AES-256-GCM with zero additional dependencies. For a credential vault this is critical: fewer dependencies = smaller attack surface. GCM mode provides authenticated encryption (confidentiality + integrity). No third-party library adds meaningful value here.
**Confidence:** High
**Avoid:** `crypto-js` -- deprecated since v4.2.0, pure JavaScript, significantly slower, and has known security concerns. Avoid any library that wraps node:crypto without adding real value.

**Implementation requirements:**
- Generate a unique 12-byte IV (nonce) via `crypto.randomBytes(12)` for every encryption operation -- never reuse
- Store IV + authTag alongside the ciphertext (commonly prepended: `iv:authTag:ciphertext` in base64)
- Derive encryption keys from a master key using HKDF or store as raw 256-bit keys
- Master key must come from an environment variable, never from source code

### Request Validation

**Choice:** `zod@^4.4`
**Rationale:** Zod is TypeScript-first: define a schema once, get both runtime validation and compile-time type inference. This eliminates the type-drift problem where schemas and TypeScript interfaces diverge. 20M+ weekly downloads, dominant in the TypeScript ecosystem (required by tRPC, standard in T3 stack, supported by Prisma's ecosystem). For an Express API, Zod pairs naturally with a small validation middleware that parses `req.body` / `req.params` / `req.query`.
**Confidence:** High
**Avoid:** `joi` -- no native TypeScript type inference, requires maintaining parallel type definitions. `express-validator` -- chain-based API is less composable and harder to reuse schemas across layers.

### Rate Limiting & Brute-Force Protection

**Choice:** `express-rate-limit@^8.6` (primary) + `rate-limiter-flexible@^5` (login/sensitive endpoints)
**Rationale:** Two-tier approach. `express-rate-limit` provides simple IP-based global rate limiting in ~10 lines -- sufficient for general API protection on a single-instance Coolify deployment. For login and credential-access endpoints, `rate-limiter-flexible` adds configurable per-user sliding windows, consecutive-failure tracking, and optional Redis backing if the deployment scales later.
**Confidence:** High (express-rate-limit), Medium (rate-limiter-flexible -- evaluate whether the extra complexity is needed at MVP)
**Avoid:** Rolling your own rate limiter. Also avoid over-engineering with Redis-backed distributed limiting for a single-container Coolify deployment -- add that if/when you scale to multiple instances.

### Logging

**Choice:** `pino@^10.3` + `pino-pretty@^13` (dev only)
**Rationale:** Pino is 4-5x faster than Winston for JSON serialization, outputs structured JSON by default (critical for audit logs in a credential vault), and requires minimal configuration. The structured JSON output feeds directly into log aggregation tools. `pino-pretty` is used only in development for human-readable console output. For an immutable audit log requirement, Pino's structured output writes directly to a dedicated audit table or append-only log.
**Confidence:** High
**Avoid:** `winston` -- slower, heavier, transport-based architecture adds complexity without benefit for a single-container deployment. `console.log` -- no structure, no levels, no timestamps.

### HTTP Security Middleware

**Choice:** `helmet@^8.3` + `cors@^2.8`
**Rationale:** Non-negotiable baseline for any Express API. Helmet sets 13+ security headers (CSP, HSTS, X-Frame-Options, etc.) with a single `app.use(helmet())`. CORS controls cross-origin access. Both are effectively zero-config for an internal API.
**Confidence:** High
**Avoid:** Manually setting security headers -- error-prone and easy to miss updates.

### Environment Configuration

**Choice:** `dotenv@^16` + `zod` (validation layer) or `@t3-oss/env-core@^0.12` (if you want a dedicated package)
**Rationale:** Use `dotenv` to load `.env` files, then validate every environment variable through a Zod schema at application startup. This catches missing/malformed config immediately rather than at first use. The pattern is: define an `env.ts` file that exports a validated, typed `env` object. All imports use this object, never `process.env` directly. Alternatively, `@t3-oss/env-core` wraps this exact pattern with Zod built in, but adds a dependency for something achievable in ~30 lines.
**Confidence:** High (dotenv + zod validation), Medium (@t3-oss/env-core -- adds a dependency for minimal gain)
**Avoid:** Reading `process.env` directly throughout the codebase -- leads to runtime crashes from typos and missing variables. Avoid `.env` files in Docker production images -- use Coolify's environment variable injection instead.

### Testing

**Choice:** `vitest@^4.1`
**Rationale:** Vitest is 2-10x faster than Jest for TypeScript projects, with native ESM/TypeScript support requiring zero transform configuration. 40M+ weekly downloads (surpassed Jest), Jest-compatible API for easy migration of knowledge. Watch mode is 28x faster than Jest's. Angular, Nuxt, and SvelteKit all adopted Vitest as their default.
**Confidence:** High
**Avoid:** `jest` -- requires ts-jest or babel-jest transform configuration, slower cold starts, ESM support still requires shimming. Not worth the setup cost for a new TypeScript project.

**Supporting test libraries:**
- `supertest@^7` -- HTTP assertion testing for Express routes
- `@faker-js/faker@^9` -- generate realistic test data for credentials, users, assets
- `vitest` built-in mocking -- replaces `jest.mock()` with `vi.mock()`

### API Documentation

**Choice:** `swagger-jsdoc@^7` + `swagger-ui-express@^5` (OpenAPI 3.0)
**Rationale:** For an internal credential management API, interactive documentation is valuable for onboarding team members and testing endpoints. swagger-jsdoc generates the OpenAPI spec from JSDoc comments co-located with route handlers (documentation stays near code). swagger-ui-express serves the interactive UI at `/api-docs`. The overhead is minimal and the payoff is high for a multi-role RBAC system where different roles see different endpoints.
**Confidence:** Medium -- valuable but not MVP-blocking. Can be added in a later phase.
**Avoid:** Maintaining a separate OpenAPI YAML file manually -- drifts from implementation. Avoid `tsoa` unless you want a fully generated controller pattern (opinionated, heavier).

---

## Key Patterns

### Token Storage & Session Approach

Use short-lived JWTs (15-minute access tokens) with longer-lived refresh tokens (7-day) stored in the database (Prisma model). This avoids server-side session storage while allowing token revocation via refresh token deletion. For an internal tool, httpOnly + secure cookies are the safest transport for tokens in a browser client. If the API is consumed by other services only, use Authorization Bearer headers.

```
Access token:  JWT signed with EdDSA or RS256, 15min expiry, contains userId + role
Refresh token: Opaque token (crypto.randomUUID), stored in DB, 7-day expiry
```

### Encryption Key Management

```
Envelope encryption pattern:
1. Master Key (MEK): 256-bit key from environment variable, never stored in DB
2. Data Encryption Keys (DEK): Per-credential random 256-bit keys, encrypted with MEK
3. Store: encrypted_dek + iv + authTag + encrypted_credential in the credential row
4. To decrypt: MEK decrypts DEK, DEK decrypts credential
```

This allows key rotation without re-encrypting every credential: rotate MEK, re-encrypt only the DEKs.

### RBAC Middleware Pattern

Define four roles as a TypeScript enum and enforce via middleware:

```typescript
// roles: OWNER, ADMIN, MANAGER, VIEWER
const requireRole = (...allowed: Role[]) => (req, res, next) => {
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// Usage: router.delete('/credentials/:id', requireRole('OWNER', 'ADMIN'), deleteCredential);
```

Store role on the User model. Check role in middleware before the route handler executes. For field-level access (e.g., Viewers cannot see decrypted secrets), handle in the service layer.

### Immutable Audit Log Pattern

Every sensitive action (credential CRUD, user role changes, login attempts, failed access) writes to an append-only `AuditLog` table:

```prisma
model AuditLog {
  id        String   @id @default(cuid())
  action    String   // e.g., "credential.read", "user.role.changed"
  actorId   String
  targetId  String?
  metadata  Json?    // additional context (IP, user-agent, before/after values)
  createdAt DateTime @default(now())

  actor     User     @relation(fields: [actorId], references: [id])

  @@index([actorId])
  @@index([action])
  @@index([createdAt])
}
```

**Critical:** Never UPDATE or DELETE from this table. Application code should only INSERT. Consider a PostgreSQL trigger or row-level security policy to enforce append-only at the database level.

### Request Validation Middleware

```typescript
import { z, ZodSchema } from 'zod';

const validate = (schema: { body?: ZodSchema; params?: ZodSchema; query?: ZodSchema }) =>
  (req, res, next) => {
    const result = z.object({
      body: schema.body ?? z.any(),
      params: schema.params ?? z.any(),
      query: schema.query ?? z.any(),
    }).safeParse(req);

    if (!result.success) return res.status(400).json({ errors: result.error.flatten() });
    // Attach parsed data to req
    next();
  };
```

### Error Handling

Use a centralized Express error handler. Define custom error classes (AppError, NotFoundError, ForbiddenError, ValidationError) that carry HTTP status codes. The error handler catches everything, logs via Pino, and returns consistent JSON error responses. Never leak stack traces or internal details in production responses.

### Project Structure

```
src/
  config/          # env.ts (validated env), constants
  middleware/       # auth, rbac, validate, errorHandler, rateLimiter
  modules/
    auth/          # auth.routes.ts, auth.controller.ts, auth.service.ts, auth.schema.ts
    credentials/   # credentials.routes.ts, .controller, .service, .schema
    assets/        # assets.routes.ts, .controller, .service, .schema
    users/         # users.routes.ts, .controller, .service, .schema
    audit/         # audit.service.ts (no direct routes -- written by other modules)
  lib/
    crypto.ts      # encrypt/decrypt wrappers, key derivation
    jwt.ts         # jose token creation/verification
    logger.ts      # pino instance
    prisma.ts      # PrismaClient singleton
  app.ts           # Express app setup (middleware, routes)
  server.ts        # HTTP server + graceful shutdown
prisma/
  schema.prisma
  migrations/
```

---

## Docker & Deployment Notes

### Dockerfile Pattern

```dockerfile
# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
```

### Key Docker Considerations

- **Prisma migrations in Docker:** Run `prisma migrate deploy` in the CMD entrypoint, before `node dist/server.js`. This ensures migrations apply on every deploy. `migrate deploy` only runs pending migrations (idempotent) and never creates new ones.
- **Prisma Client generation:** Must run `prisma generate` during the build stage so the generated client is included in the image.
- **Copy prisma directory to production stage:** `migrate deploy` needs the `prisma/` folder with schema and migration files at runtime.
- **Multi-stage build:** Keep the final image small. The builder stage has devDependencies; the runner stage has only production files. For `@node-rs/argon2`, the native binary is included in `node_modules` and must be copied.
- **Node.js 22 Alpine:** Use the current LTS. Alpine reduces image size.

### Coolify-Specific Configuration

- **Environment variables:** Set `DATABASE_URL`, `MASTER_ENCRYPTION_KEY`, `JWT_SECRET`, and all other secrets in Coolify's environment variable UI. Never bake them into the Docker image.
- **PostgreSQL:** Deploy PostgreSQL as a separate service from Coolify's database panel. Coolify exposes an internal URL (e.g., `postgresql://user:pass@project-db:5432/kickvault`) that your app container can reach on the internal Docker network.
- **Health check:** Coolify uses the Docker HEALTHCHECK to determine container readiness. Expose a `GET /health` endpoint that returns 200 when the app is ready (optionally check DB connectivity).
- **Persistent data:** PostgreSQL data must be on a Coolify-managed volume. Never store credential data in the app container's filesystem.
- **Build command:** If using Coolify's Dockerfile-based deployment (recommended), point it to your Dockerfile. Avoid Nixpacks/Buildpacks for better control over the multi-stage build and migration step.

### Environment Variable Checklist

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/kickvault
MASTER_ENCRYPTION_KEY=   # 64-char hex string (256-bit key)
JWT_PRIVATE_KEY=          # EdDSA or RSA private key (PEM or JWK)
JWT_PUBLIC_KEY=           # Corresponding public key
NODE_ENV=production

# Optional
PORT=3000
LOG_LEVEL=info
CORS_ORIGIN=https://internal.kickoff.africa
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

---

## Full Dependency Summary

### Production Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| express | ^5.1 | HTTP framework |
| jose | ^6.2 | JWT sign/verify/encrypt |
| @node-rs/argon2 | ^2.0 | Password hashing (Argon2id) |
| zod | ^4.4 | Request validation + env validation |
| @prisma/client | ^6.x | Database ORM client |
| pino | ^10.3 | Structured JSON logging |
| pino-http | ^10 | Express request logging middleware |
| helmet | ^8.3 | HTTP security headers |
| cors | ^2.8 | CORS middleware |
| express-rate-limit | ^8.6 | IP-based rate limiting |
| dotenv | ^16 | .env file loading |
| swagger-jsdoc | ^7 | OpenAPI spec generation |
| swagger-ui-express | ^5 | Swagger UI serving |

### Dev Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| typescript | ^5.8 | TypeScript compiler |
| prisma | ^6.x | Prisma CLI (migrations, generate) |
| vitest | ^4.1 | Test runner |
| supertest | ^7 | HTTP testing |
| @faker-js/faker | ^9 | Test data generation |
| pino-pretty | ^13 | Dev-only log formatting |
| tsx | ^4 | TypeScript execution for dev |
| @types/express | ^5 | Express type definitions |
| @types/cors | ^2 | CORS type definitions |
| @types/supertest | ^6 | Supertest type definitions |

---

## Decisions NOT Made (Evaluate Later)

- **Redis:** Not needed at MVP for single-container Coolify deployment. Add if rate limiting needs to be distributed or if refresh token revocation needs sub-second performance.
- **Queue system (BullMQ):** Not needed unless async jobs emerge (e.g., scheduled credential rotation, bulk import).
- **OpenTelemetry:** Valuable for observability but not MVP-critical. Pino has native OTel support when ready.
- **GraphQL:** Not applicable -- REST is the correct choice for a CRUD-heavy credential vault with RBAC.
