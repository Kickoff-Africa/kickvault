# Pitfalls Research: Kick Vault

> Research date: 2026-07-29
> Scope: credential vault and secrets management REST APIs
> Stack context: Node.js + TypeScript + Express + Prisma + PostgreSQL + Docker/Coolify

---

## Critical Pitfalls (Security)

### 1. AES-256 IV Reuse — Deterministic Ciphertext Enables Pattern Analysis

**Risk:** If the same Initialization Vector (IV) is reused with the same key, identical plaintexts produce identical ciphertexts. An attacker with database access can identify duplicate passwords across users without decrypting anything. Worse, with AES-CBC, IV reuse enables full plaintext recovery via XOR analysis of ciphertext blocks.

**Warning signs:**
- Hardcoded IV in source code or config
- IV stored as a constant instead of per-record
- Ciphertext column values that repeat across rows
- Unit tests that produce deterministic ciphertext for the same input

**Prevention:**
- Generate a cryptographically random 16-byte IV per encryption operation using `crypto.randomBytes(16)`
- Store the IV alongside the ciphertext (commonly prepended: `iv:ciphertext` or as a separate DB column)
- Use AES-256-GCM (authenticated encryption) instead of AES-256-CBC — GCM provides both confidentiality and integrity, and nonce reuse is detectable
- Add a test that encrypting the same plaintext twice produces different ciphertext

**Phase to address:** Phase 1 (encryption module foundation) — must be correct from the first line of crypto code

---

### 2. AES-256 in ECB Mode — Block-Level Pattern Leakage

**Risk:** ECB mode encrypts each 16-byte block independently. Identical plaintext blocks produce identical ciphertext blocks, leaking structure. This is the "encrypted penguin" problem. Node's `crypto.createCipheriv` requires you to specify the mode explicitly, but tutorials sometimes default to ECB.

**Warning signs:**
- Algorithm string `aes-256-ecb` in code
- No IV parameter in encryption function (ECB doesn't use one)
- Ciphertext length exactly equal to padded plaintext length with no IV prefix

**Prevention:**
- Use `aes-256-gcm` exclusively — it provides authenticated encryption (confidentiality + integrity + authentication)
- Lint rule or code review checklist item: reject any algorithm string containing `ecb`
- Wrap all crypto behind a single `encrypt()`/`decrypt()` module so the algorithm choice is made once

**Phase to address:** Phase 1 — architecture decision, never revisited

---

### 3. Encryption Key Stored in Source Code or Plain Environment Variable

**Risk:** The AES-256 master key is the single point of failure. If it's committed to Git, baked into a Docker image, or stored as a plain `ENCRYPTION_KEY=...` in a `.env` file that's volume-mounted, any container escape or backup leak exposes every credential in the database simultaneously.

**Warning signs:**
- `ENCRYPTION_KEY` visible in `docker-compose.yml`, Coolify environment panel, or `.env` committed to repo
- Key is a human-readable string (e.g., `mysecretkey123`) instead of a 32-byte hex/base64 value
- Same key used across development, staging, and production
- No documentation for key rotation procedure

**Prevention:**
- Generate key with `openssl rand -hex 32` (produces 64-char hex = 256 bits)
- In Coolify: use encrypted environment variables (Coolify encrypts env vars at rest) — but document that this is a single layer, not defense-in-depth
- Never commit the key to Git; add `ENCRYPTION_KEY` to `.gitignore` and `.dockerignore`
- For production hardening (v2): consider envelope encryption — encrypt the data key with a master key, store the encrypted data key in the DB, and keep the master key in a separate secrets store
- Document key rotation procedure before go-live, even if rotation is manual in v1

**Phase to address:** Phase 1 (encryption module) for key generation; pre-deployment phase for operational key management

---

### 4. Plaintext Leaking into Logs, Error Messages, or Stack Traces

**Risk:** A credential's decrypted value appears in an Express error response, a `console.log` debug statement, a Prisma query log, or a Node.js unhandled rejection trace. Once in logs, it's effectively stored in plaintext — violating the zero-knowledge requirement.

**Warning signs:**
- `console.log(req.body)` anywhere in credential-handling routes
- Prisma query logging enabled (`log: ['query']`) in production — logs SQL with parameter values
- Express default error handler returning full error objects (which may include locals)
- `JSON.stringify(credential)` in catch blocks
- Sentry/error tracking capturing request bodies

**Prevention:**
- Create a `SensitiveValue` wrapper type (branded type or class) whose `toString()` and `toJSON()` return `[REDACTED]` — this prevents accidental serialization
- Strip `secret`, `password`, `plaintext`, and `decrypted` fields from all error handler output
- Disable Prisma query logging in production; use `log: ['error', 'warn']` only
- Set Express to production mode (`NODE_ENV=production`) which suppresses stack traces
- Add a middleware that redacts sensitive fields from `req.body` before any logging
- Pre-commit grep hook: reject `console.log` in `src/` directories

**Phase to address:** Phase 1 (encryption + API skeleton) — establish patterns before any credential routes exist

---

### 5. JWT Secret Too Weak or Hardcoded

**Risk:** If the JWT signing secret is short, predictable, or shared across environments, tokens can be forged. An attacker with a forged SUPER_ADMIN token owns the entire vault. Common mistake: using `"secret"` or `"jwt-secret"` during development and forgetting to change it.

**Warning signs:**
- JWT secret shorter than 256 bits
- Secret is a dictionary word or common phrase
- Same secret in `.env.example` and production
- No environment variable validation at startup (app boots with empty/missing secret)

**Prevention:**
- Generate with `openssl rand -base64 64`
- Validate at startup: if `JWT_SECRET` is missing or shorter than 32 characters, refuse to start
- Use asymmetric signing (RS256) if multiple services will verify tokens — for a single API, HS256 with a strong secret is sufficient
- Add `JWT_SECRET` to required environment variables checked at boot

**Phase to address:** Phase 1 (authentication module)

---

### 6. No Token Invalidation — Logout is a Frontend Illusion

**Risk:** JWTs are stateless. If the only "logout" mechanism is deleting the token on the client side, a stolen token remains valid until expiry. With a 15-minute session timeout, that's a 15-minute window. If tokens are long-lived (hours/days), the window is massive.

**Warning signs:**
- No token blocklist or session store in the architecture
- Logout endpoint returns 200 but does nothing server-side
- Deactivated users can still make API calls with existing tokens
- Password change doesn't invalidate existing tokens

**Prevention:**
- Maintain a server-side session store (Redis or DB table) that maps `jti` (JWT ID) to validity status
- On logout: add the `jti` to a blocklist (or delete the session record)
- On user deactivation: invalidate all sessions for that user immediately
- On password change: invalidate all existing sessions
- Keep token expiry short (15 min) and use refresh tokens for renewal — validate refresh tokens against the session store
- Alternative for v1 simplicity: use opaque session tokens stored in DB instead of JWTs — simpler invalidation at the cost of a DB lookup per request

**Phase to address:** Phase 1 (authentication module) — design decision that's hard to retrofit

---

### 7. Brute Force Protection Gaps — Lockout Bypass via Timing or Account Enumeration

**Risk:** The PRD requires lockout after 5 failed attempts, but common gaps include: (a) lockout resets on successful login from a different account, (b) timing differences between "user not found" and "wrong password" enable account enumeration, (c) lockout is per-session instead of per-account, (d) no rate limiting on the login endpoint itself.

**Warning signs:**
- Login endpoint responds in 50ms for invalid username but 200ms for wrong password (bcrypt timing)
- Failed attempt counter stored in application memory (lost on restart)
- No rate limiting middleware on `/auth/login`
- Lockout duration not configurable or not enforced

**Prevention:**
- Always run `bcrypt.compare()` even when the user doesn't exist (compare against a dummy hash) to normalize timing
- Store failed attempt counter in the database (Prisma: `failedLoginAttempts` and `lockedUntil` fields on User)
- Apply express-rate-limit on the login endpoint: e.g., 10 requests per minute per IP
- Return identical error messages for "user not found" and "wrong password": `"Invalid credentials"`
- Log failed attempts in the audit log (for security monitoring)
- Make lockout duration configurable via environment variable with a sensible default (15-30 minutes)

**Phase to address:** Phase 1 (authentication) — must be correct at launch

---

### 8. Horizontal Privilege Escalation — User A Accesses User B's Credentials

**Risk:** RBAC checks verify "does this user have the Member role?" but forget to verify "does this user own (or have access to) this specific credential?" A Member can guess or enumerate credential IDs and access/modify credentials belonging to other users or groups they're not in.

**Warning signs:**
- API endpoints use `GET /credentials/:id` without checking ownership or group membership
- Tests only verify that unauthorized *roles* are rejected, not that authorized roles can't cross boundaries
- Sequential integer IDs make enumeration trivial
- No concept of "credential ownership" or "vault/folder sharing" in the data model

**Prevention:**
- Every query that fetches a credential must include a WHERE clause that scopes to the user's accessible resources: `WHERE id = :id AND (ownerId = :userId OR vaultId IN (:accessibleVaults))`
- Use UUIDs for all resource IDs (prevents enumeration)
- Write explicit integration tests: "User A creates credential, User B (same role) tries to access it — expect 403 or 404"
- Decide on access model early: per-user ownership, shared vaults/folders, or organization-wide with role-based visibility
- Middleware pattern: `authorize(resource, action)` that loads the resource and checks both role AND ownership

**Phase to address:** Phase 1 (RBAC + credential CRUD) — data model must support ownership from day one

---

### 9. Missing Role Checks on Edge-Case Endpoints

**Risk:** The main CRUD endpoints have RBAC middleware, but auxiliary endpoints are forgotten: bulk export, search, dashboard stats, audit log access, user profile updates, credential sharing. A Viewer who shouldn't see raw credentials accesses `/credentials/export` which wasn't protected.

**Warning signs:**
- RBAC middleware applied per-route instead of per-router (easy to miss new routes)
- No default-deny policy (routes without explicit middleware are open)
- Search endpoint returns credential metadata that reveals secrets
- Dashboard stats endpoint leaks counts that should be role-restricted

**Prevention:**
- Apply authentication middleware globally (`app.use(authenticate)`) and require explicit `public` marking for open routes
- Apply a default-deny authorization middleware: every route must declare its required role, or it returns 403
- Create a route registration helper: `protectedRoute('MEMBER', handler)` that makes it impossible to forget
- Maintain a route matrix in tests: enumerate all registered routes and verify each has an associated RBAC test
- The audit log endpoint should itself be restricted to SUPER_ADMIN and Manager roles

**Phase to address:** Phase 1 (RBAC framework) — establish the default-deny pattern before adding routes

---

### 10. Audit Log Bypass — Direct DB Writes Skip Application-Layer Logging

**Risk:** The audit log is implemented as Express middleware or service-layer code, but direct Prisma operations (background jobs, seed scripts, admin fixes, migration scripts) bypass it. An admin modifies credentials via a Prisma script with no audit trail.

**Warning signs:**
- Audit logging implemented only in route handlers, not in the service/repository layer
- Prisma `$executeRaw` or `$queryRaw` used without corresponding audit entries
- Seed scripts and migration scripts modify credential data
- No database-level trigger for critical tables

**Prevention:**
- Implement audit logging at the lowest possible layer — Prisma middleware (`$use`) that intercepts all write operations on sensitive tables
- For defense-in-depth: add a PostgreSQL trigger on the credentials table that inserts into the audit log on any UPDATE/DELETE
- Make the audit log table append-only at the database level: revoke DELETE and UPDATE permissions for the application's DB user on the audit_log table
- Never use `$executeRaw` for credential operations
- Document that direct DB access (psql, pgAdmin) must never modify credentials — operational runbook item

**Phase to address:** Phase 1 (audit log module) — Prisma middleware must be in place before any CRUD routes

---

### 11. Audit Log Tampering — Mutable Log Defeats Compliance

**Risk:** The PRD says "immutable audit log" but the implementation only omits a DELETE endpoint. An attacker who gains DB access (SQL injection, leaked credentials) can UPDATE or DELETE audit rows directly. The log provides false assurance.

**Warning signs:**
- Application DB user has full CRUD permissions on audit_log table
- No integrity verification mechanism (hashes, checksums)
- Audit log entries lack sequence verification (gaps aren't detectable)
- No off-site backup of audit logs

**Prevention:**
- Revoke DELETE and UPDATE on audit_log for the application DB user (PostgreSQL GRANT/REVOKE)
- Add a hash chain: each audit entry includes `previousHash` = SHA-256 of the previous entry — any deletion or modification breaks the chain
- Add a sequential `sequence_number` column with a unique constraint — deletions create detectable gaps
- Export audit logs to an append-only external store (even a separate DB or file) periodically
- For v1 minimum: revoke DELETE/UPDATE + periodic backup is sufficient

**Phase to address:** Phase 1 (audit log) for DB permissions; Phase 2 for hash chain integrity

---

### 12. Encryption Key Loss — No Recovery Path

**Risk:** The AES-256 encryption key is stored in an environment variable. If the Coolify instance is rebuilt, the VM is reimaged, or the env var is accidentally cleared, ALL credentials become permanently unrecoverable. There is no master password or HSM backup. This is a total data loss scenario.

**Warning signs:**
- No documented key backup procedure
- Key exists in exactly one location (Coolify env panel)
- No test of key restoration from backup
- Team members don't know where the key is stored

**Prevention:**
- Document the encryption key in a secure, offline location (printed and stored in a physical safe, or split across multiple trusted individuals using Shamir's Secret Sharing)
- Test key restoration: simulate Coolify rebuild and verify credentials remain decryptable
- Consider key escrow: encrypt the master key with a recovery passphrase known to multiple admins
- Add startup validation: on boot, attempt to decrypt a known test credential to verify the key is correct before accepting traffic

**Phase to address:** Pre-deployment — operational procedure, not code

---

## Common Pitfalls (Operational)

### 13. Audit Log Unbounded Growth — Query Performance Degrades Over Time

**Risk:** With 200 users and 10,000 credentials, the audit log grows rapidly. At 50 actions per user per day, that's 10,000 entries/day or 3.65M entries/year. Without indexing and pagination, listing audit logs becomes a full table scan. The 12-month retention requirement means at least 3.65M rows.

**Warning signs:**
- Audit log queries getting slower over weeks/months
- No pagination on audit log endpoints
- Missing indexes on `timestamp`, `userId`, `credentialId`, `action` columns
- No data archival or partitioning strategy

**Prevention:**
- Add composite indexes: `(userId, createdAt)`, `(credentialId, createdAt)`, `(action, createdAt)`
- Require cursor-based pagination on all audit log endpoints (never allow unbounded SELECT)
- Plan table partitioning by month (PostgreSQL native partitioning) for logs older than 3 months
- Archive logs older than 12 months to cold storage (compressed JSON export to file storage)
- Monitor query execution times in production

**Phase to address:** Phase 1 for indexes and pagination; operational phase for archival strategy

---

### 14. No Database Backup Strategy — Single Point of Failure

**Risk:** Self-hosted PostgreSQL on Coolify means backups are the team's responsibility. If the disk fails, a bad migration drops tables, or ransomware hits the VM, everything is lost — encrypted credentials, users, audit logs.

**Warning signs:**
- No `pg_dump` cron job configured
- No backup verification (restoring to a test instance)
- Backups stored on the same disk/VM as the database
- No documented Recovery Point Objective (RPO) or Recovery Time Objective (RTO)

**Prevention:**
- Configure automated `pg_dump` backups (daily at minimum, hourly for critical data)
- Store backups off-site (different VM, cloud storage bucket, or Coolify's built-in backup if available)
- Test restore procedure monthly
- Document RPO (max acceptable data loss, e.g., 1 hour) and RTO (max acceptable downtime, e.g., 4 hours)
- Encrypt backups at rest (they contain encrypted credentials, but also contain user data and audit logs in plaintext)

**Phase to address:** Pre-deployment — must be in place before production data exists

---

### 15. No Encryption Key Rotation Plan

**Risk:** If the encryption key is ever suspected of being compromised, or after a period of time (compliance often requires annual rotation), all credentials must be re-encrypted with a new key. Without a plan, this is a panic-mode scramble that risks data loss.

**Warning signs:**
- No `keyVersion` field in the credential schema
- No tooling to re-encrypt credentials in bulk
- Single key referenced directly (no key registry or versioning)
- No documented procedure for "what to do if the key is compromised"

**Prevention:**
- Add a `keyVersion` (integer) column to the credentials table from day one
- Store keys in a versioned format: `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_V2`
- Build a migration script that reads with old key, encrypts with new key, updates `keyVersion`
- Decrypt function checks `keyVersion` and selects the appropriate key
- This can be a v2 feature, but the `keyVersion` column must exist from v1

**Phase to address:** Phase 1 for `keyVersion` column; v2 for rotation tooling

---

### 16. Docker Container Restart Loses In-Memory State

**Risk:** If encryption keys, session data, or rate limit counters are stored in application memory, a container restart (common in Coolify during redeployment) resets everything. Users get logged out, rate limits reset, and if the key was derived at runtime without persistence, it's gone.

**Warning signs:**
- In-memory session store (default `express-session` memory store)
- Rate limit counters in application memory (reset to 0 on restart)
- Failed login attempt counters in memory (lockout resets on restart)
- Encryption key derived at startup from a seed that changes

**Prevention:**
- Store sessions in PostgreSQL (via `connect-pg-simple`) or Redis
- Store failed login attempts in the database (User table fields)
- Use database-backed rate limiting or Redis
- Encryption key loaded from environment variable (stable across restarts)
- Test the full restart cycle: `docker restart` should not log out users or reset security counters

**Phase to address:** Phase 1 — architecture decisions for state storage

---

### 17. Secrets Baked into Docker Image Layers

**Risk:** If `COPY .env .` appears in the Dockerfile, or environment variables are set via `ENV ENCRYPTION_KEY=...` in the Dockerfile, the secrets are permanently embedded in the image layers. Anyone who pulls the image (even after the ENV is removed in a later layer) can extract them with `docker history` or `docker save`.

**Warning signs:**
- `.env` file not in `.dockerignore`
- `ENV` directives with sensitive values in Dockerfile
- `ARG` used for secrets during build and not cleared
- Docker image pushed to a registry that others can pull

**Prevention:**
- Add `.env` to `.dockerignore` (mandatory)
- Never use `ENV` or `ARG` for secrets in the Dockerfile
- Pass secrets exclusively via Coolify's environment variable injection at runtime
- Use multi-stage builds: build stage can have dependencies, runtime stage is clean
- Audit Dockerfile before every deployment

**Phase to address:** Phase 1 (Docker setup) — get this right in the initial Dockerfile

---

### 18. Migration Failures in Production Docker Deployment

**Risk:** `prisma migrate deploy` runs on container start but fails — the container crashes, restarts, fails again, crash loops. Common causes: migration requires a lock that conflicts with the running instance, migration has a breaking schema change without data migration, or the database isn't ready when the container starts.

**Warning signs:**
- Container logs show "Migration failed" followed by restart
- `prisma migrate deploy` in the Docker `CMD` or entrypoint
- No health check before migration runs
- Migrations not tested against production-like data

**Prevention:**
- Run migrations as a separate init step (Kubernetes init container pattern, or a separate Coolify service/pre-deploy script), NOT in the application's CMD
- Add a database readiness check (retry loop) before running migrations
- Test every migration against a copy of production data before deploying
- Never use `prisma migrate dev` in production — only `prisma migrate deploy`
- Have a rollback plan for each migration (Prisma doesn't auto-rollback, so write manual DOWN migrations)

**Phase to address:** Phase 1 (Docker/deployment setup) — establish the migration pattern early

---

## TypeScript/Prisma Specific

### 19. Type Assertions Hiding Runtime Errors in Crypto Code

**Risk:** TypeScript's `as` keyword tells the compiler "trust me" but doesn't validate at runtime. Crypto code with `const key = process.env.ENCRYPTION_KEY as string` will compile fine but crash at runtime with a cryptic `Buffer.from` error if the env var is undefined. Worse, `as Buffer` on a wrong type won't throw until the OpenSSL layer hits garbage data.

**Warning signs:**
- `as string`, `as Buffer`, `as any` in crypto-related files
- No runtime validation of environment variables at startup
- Type errors only caught when a specific code path executes in production
- Crypto functions accepting `string | undefined` parameters

**Prevention:**
- Use a startup validation module (e.g., `zod` schema for `process.env`) that throws on missing or invalid values BEFORE the app starts
- In crypto functions, use runtime checks: `if (!key || key.length !== 64) throw new ConfigError(...)`
- Ban `as any` via ESLint rule (`@typescript-eslint/no-explicit-any`)
- Prefer `unknown` over `any` for external inputs, then narrow with type guards
- Write unit tests that call crypto functions with undefined/empty inputs

**Phase to address:** Phase 1 — TypeScript configuration and coding standards

---

### 20. `any` Types in Security-Critical Code

**Risk:** Using `any` in request handlers, middleware, or crypto code defeats TypeScript's purpose. A handler typed `(req: any, res: any)` won't catch missing fields, wrong types, or extra fields. A credential object typed as `any` could have its `secret` field serialized without warning.

**Warning signs:**
- `any` type count growing over time
- Request body accessed without validation: `req.body.password` with no schema
- Catch blocks with `catch (e)` (implicitly `unknown` in TS 4.4+, but older configs default to `any`)
- Prisma results cast to `any` to "fix" type errors

**Prevention:**
- Enable strict TypeScript config: `strict: true`, `noImplicitAny: true`
- Use request validation library (zod, joi, class-validator) on every endpoint — parse request body into a typed object
- ESLint rules: `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-unsafe-assignment`
- Type Express request handlers with proper generics: `Request<Params, ResBody, ReqBody>`
- Never suppress type errors with `any` — fix the underlying type issue

**Phase to address:** Phase 1 — tsconfig.json and ESLint setup

---

### 21. Prisma N+1 Queries — Silent Performance Killer

**Risk:** Prisma makes it easy to write code that looks like one query but executes N+1 queries. Example: fetch 100 credentials, then for each one, fetch its audit logs. With 10,000 credentials, this becomes 10,001 queries. Prisma won't warn you.

**Warning signs:**
- Loop inside which a Prisma query executes: `for (const cred of creds) { await prisma.auditLog.findMany({where: {credentialId: cred.id}}) }`
- API endpoints that slow down proportionally to data volume
- Database connection pool exhaustion under moderate load
- No query monitoring or logging in development

**Prevention:**
- Use Prisma's `include` for eager loading: `prisma.credential.findMany({ include: { auditLogs: true } })`
- Use `select` to fetch only needed fields (reduces payload and memory)
- Enable Prisma query logging in development (`log: ['query']`) and review query counts per endpoint
- Add integration tests that assert query count for list endpoints
- For complex queries, use Prisma's `$queryRaw` with JOINs instead of multiple round trips

**Phase to address:** Phase 1 — establish query patterns in the first repository methods

---

### 22. Prisma Client Not Properly Managed in Docker — Connection Pool Exhaustion

**Risk:** Creating a new `PrismaClient()` instance per request (or per module import in a way that hot reloading creates multiples) exhausts PostgreSQL's connection pool. Default Prisma pool is 5 connections; PostgreSQL default is 100. With middleware, background jobs, and hot reloading, this is quickly exceeded.

**Warning signs:**
- `new PrismaClient()` appearing in multiple files
- "Too many connections" errors in PostgreSQL logs
- Connection timeout errors under low load
- Different behavior between development (with hot reload) and production

**Prevention:**
- Create a single `PrismaClient` instance in a dedicated `src/lib/prisma.ts` module and import it everywhere
- Set connection pool size explicitly: `datasource db { url = env("DATABASE_URL") }` and configure `?connection_limit=10` in the URL
- In Docker: set `pool_timeout` in the connection string
- Add a graceful shutdown handler: `process.on('SIGTERM', () => prisma.$disconnect())`

**Phase to address:** Phase 1 — project scaffolding

---

### 23. Overly Permissive CORS Allowing Cross-Origin Credential Theft

**Risk:** Setting `cors({ origin: '*' })` during development and forgetting to restrict it in production means any website can make authenticated API calls if the user has a valid session/token. For a credential vault, this means a malicious site could exfiltrate all stored credentials.

**Warning signs:**
- `cors({ origin: '*' })` or `cors()` with no options in production code
- No environment-specific CORS configuration
- `Access-Control-Allow-Credentials: true` combined with wildcard origin (browsers block this, but misconfigurations happen)

**Prevention:**
- Configure CORS with explicit allowed origins from environment variable: `cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') })`
- In v1 (API-only, no frontend), consider disabling CORS entirely or allowing only specific development tools
- Never combine `credentials: true` with wildcard origin
- Test CORS headers in integration tests

**Phase to address:** Phase 1 (Express middleware setup)

---

### 24. Bcrypt Work Factor Too Low — Cheap Brute Force on Stolen Hashes

**Risk:** If the bcrypt cost factor is set to the minimum (4) or a low value (8), password hashes can be brute-forced quickly if the database is compromised. Many tutorials use low values for "faster tests" and that default propagates to production.

**Warning signs:**
- `bcrypt.hash(password, 4)` or any saltRounds below 12
- Login endpoint responds in under 10ms (suggests very low work factor)
- No configuration for bcrypt rounds
- Tests using a lower work factor than production (acceptable) but production value not explicitly set

**Prevention:**
- Use saltRounds of 12 minimum (takes ~250ms on modern hardware — well within 2-second response requirement)
- Make it configurable via environment variable with a floor: `Math.max(parseInt(process.env.BCRYPT_ROUNDS || '12'), 12)`
- Accept slower tests or use a test-specific lower value with a guard that prevents it in production
- Re-hash on login if the stored hash uses an older/lower cost factor (future-proofing for upgrades)

**Phase to address:** Phase 1 (authentication module)

---

### 25. Missing Request Body Size Limits — Memory Exhaustion DoS

**Risk:** Express doesn't limit request body size by default beyond its JSON parser's default of 100kb. If custom parsing is used, or if file upload is added later, an attacker can send a multi-GB request body and exhaust container memory, crashing the service.

**Warning signs:**
- `express.json()` with no `limit` option
- No request timeout configured
- Container runs without memory limits in Docker/Coolify
- No reverse proxy (nginx) in front of Express

**Prevention:**
- Set `express.json({ limit: '10kb' })` — credential payloads are small
- Set `express.urlencoded({ limit: '10kb', extended: false })`
- Configure Docker container memory limits in Coolify
- Set request timeout: `server.setTimeout(30000)` (30 seconds)
- Consider a reverse proxy (nginx/Caddy in Coolify) for additional protection

**Phase to address:** Phase 1 (Express middleware setup)

---

### 26. No Health Check Endpoint — Silent Failures in Production

**Risk:** The container appears "running" to Coolify but the application has crashed internally (unhandled promise rejection, database connection lost, encryption key invalid). Without a health check, traffic continues to route to a dead process, and no alerts fire.

**Warning signs:**
- Coolify shows container as "running" but API returns 502
- No health check configured in Dockerfile or Coolify
- Application crashes are only discovered when users report errors
- Database connection lost but container stays up

**Prevention:**
- Add `GET /health` endpoint that verifies: (1) app is running, (2) database is reachable (`SELECT 1`), (3) encryption key is valid (decrypt test value)
- Configure Docker HEALTHCHECK in Dockerfile: `HEALTHCHECK --interval=30s CMD curl -f http://localhost:3000/health || exit 1`
- Configure Coolify health check to hit this endpoint
- Health endpoint should NOT require authentication

**Phase to address:** Phase 1 (Express setup) — trivial to add early, painful to retrofit

---

### 27. Session Timeout Not Enforced Server-Side

**Risk:** The PRD requires 15-minute inactivity timeout, but if this is only enforced client-side (frontend deletes token after 15 minutes), the token itself remains valid server-side. A stolen token works until its JWT expiry, regardless of inactivity.

**Warning signs:**
- JWT expiry set to hours/days but "session timeout" is a frontend-only concept
- No server-side tracking of last activity time
- Token works after 15 minutes of inactivity

**Prevention:**
- Store `lastActivityAt` in the session store (DB or Redis)
- On every authenticated request, check: `if (now - lastActivityAt > 15 minutes) reject and invalidate`
- Update `lastActivityAt` on every successful request
- Make timeout configurable via environment variable
- Alternative: use short-lived JWTs (15 min) with refresh tokens — the refresh endpoint acts as the activity check

**Phase to address:** Phase 1 (authentication/session module)

---

### 28. Credential Metadata Exposure — Titles and URLs in Plaintext

**Risk:** Only the credential `secret` (password/key) is encrypted, but the `title`, `url`, `username`, and `notes` fields are stored in plaintext. If the database is breached, an attacker knows exactly which services the organization uses, which accounts exist, and which usernames to target — even without decrypting passwords.

**Warning signs:**
- Only one column is encrypted in the credentials table
- Search functionality works on plaintext metadata columns
- Database backups contain readable credential metadata

**Prevention:**
- Decide explicitly which fields to encrypt — at minimum: `secret`, `notes`. Consider encrypting `username` and `url` as well
- Document the threat model: "database breach exposes metadata but not secrets" — is this acceptable?
- If searching encrypted fields is needed, implement encrypted search indexes (blind indexing with HMAC) or accept that encrypted fields can only be searched after decryption
- For v1: encrypt `secret` and `notes`; store `title` and `category` in plaintext for search functionality; document this as a known trade-off

**Phase to address:** Phase 1 (data model and encryption design) — decide the encryption boundary explicitly

---

## Summary

| Category | Highest Priority Pitfalls | Must Address In |
|----------|--------------------------|-----------------|
| Encryption | IV reuse, ECB mode, key in source, plaintext logging | Phase 1 |
| Authentication | Weak JWT secret, no token invalidation, timing attacks | Phase 1 |
| RBAC | Horizontal escalation, missing checks on new routes | Phase 1 |
| Audit Log | Bypass via direct DB, tampering, unbounded growth | Phase 1 + ops |
| Prisma/ORM | N+1 queries, single client instance, migration strategy | Phase 1 |
| Docker/Ops | Secrets in image, key loss, no backups, no health check | Phase 1 + pre-deploy |
| TypeScript | `any` in crypto code, type assertions hiding undefined | Phase 1 (tsconfig) |

---

*This research document informs the Kick Vault roadmap and should be cross-referenced during phase planning and code review.*
