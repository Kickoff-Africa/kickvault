# Architecture Research: Kick Vault

> Credential governance REST API for Kickoff Africa
> Stack: Node.js + TypeScript + Express + Prisma ORM + PostgreSQL
> Deployment: Docker + Coolify (self-hosted)

---

## System Components

```
                    +-------------------+
                    |   Coolify/Traefik |  (Reverse Proxy + TLS)
                    +--------+----------+
                             |
                    +--------v----------+
                    |   Express Server  |
                    |  (src/server.ts)  |
                    +--------+----------+
                             |
          +------------------+-------------------+
          |                  |                   |
+---------v------+  +--------v--------+  +-------v--------+
| Auth Middleware |  | RBAC Middleware  |  | Audit Middleware|
| (JWT verify)   |  | (role + perm)   |  | (log all ops)  |
+--------+-------+  +--------+--------+  +-------+--------+
         |                   |                    |
         +-------------------+--------------------+
                             |
                    +--------v----------+
                    |   Route Handlers  |
                    |  (controllers)    |
                    +--------+----------+
                             |
                    +--------v----------+
                    |   Service Layer   |
                    | (business logic)  |
                    +--------+----------+
                             |
              +--------------+--------------+
              |                             |
     +--------v----------+       +---------v---------+
     |   Prisma Client   |       |  Crypto Service   |
     |   (DB access)     |       | (encrypt/decrypt) |
     +--------+----------+       +---------+---------+
              |                             |
     +--------v----------+       +---------v---------+
     |   PostgreSQL DB   |       | Encryption Keys   |
     |  (encrypted cols) |       | (env/derived)     |
     +--------------------+       +-------------------+
```

### Component Responsibilities

| Component | Responsibility |
|---|---|
| **Express Server** | HTTP listener, middleware pipeline, graceful shutdown |
| **Auth Middleware** | JWT token validation, user identity extraction |
| **RBAC Middleware** | Role/permission enforcement per route |
| **Audit Middleware** | Automatic, non-bypassable logging of all state-changing operations |
| **Route Handlers** | Request parsing, input validation (Zod), response formatting |
| **Service Layer** | Business logic, orchestration of DB + crypto operations |
| **Crypto Service** | AES-256-GCM encrypt/decrypt, key derivation, never logs plaintext |
| **Prisma Client** | Type-safe DB queries, migrations, connection pooling |

---

## Recommended Folder Structure

```
src/
  server.ts                  # HTTP listener, graceful shutdown
  app.ts                     # Express app setup, global middleware
  config/
    index.ts                 # Environment variable loading + validation
    database.ts              # Prisma client singleton
    encryption.ts            # Encryption config (algorithm, key length)
  middleware/
    authenticate.ts          # JWT verification, attaches user to req
    authorize.ts             # RBAC guard: authorize('credentials:read')
    audit.ts                 # Automatic audit log on every mutating request
    validate.ts              # Zod schema validation wrapper
    errorHandler.ts          # Global error handler (sanitizes errors)
    rateLimiter.ts           # Rate limiting per IP/user
  modules/
    auth/
      auth.routes.ts         # POST /auth/login, POST /auth/refresh
      auth.controller.ts     # Request handling
      auth.service.ts        # Login logic, token issuance
      auth.schema.ts         # Zod validation schemas
    users/
      users.routes.ts        # CRUD /users
      users.controller.ts
      users.service.ts
      users.schema.ts
    credentials/
      credentials.routes.ts  # CRUD /credentials, POST /credentials/:id/reveal
      credentials.controller.ts
      credentials.service.ts
      credentials.schema.ts
    assets/
      assets.routes.ts       # CRUD /assets (domains, servers, accounts)
      assets.controller.ts
      assets.service.ts
      assets.schema.ts
    audit/
      audit.routes.ts        # GET /audit-logs (read-only, no DELETE)
      audit.controller.ts
      audit.service.ts
      audit.schema.ts
  lib/
    crypto.ts                # AES-256-GCM encrypt/decrypt functions
    keyDerivation.ts         # PBKDF2/HKDF key derivation from master key
    hash.ts                  # Hashing utilities (bcrypt for passwords)
    jwt.ts                   # JWT sign/verify helpers
    logger.ts                # Structured logger (pino or winston)
    errors.ts                # Custom error classes (AppError, NotFoundError)
  types/
    express.d.ts             # Augment Express Request with user, permissions
    index.ts                 # Shared type definitions
  prisma/
    schema.prisma            # Prisma schema file
    migrations/              # Migration history
    seed.ts                  # Seed script (default admin, roles)
  scripts/
    start.sh                 # Migration + server start for Docker
  __tests__/                 # Test files mirroring src structure
docker/
  Dockerfile
  docker-compose.yml
  .env.example
```

### Why This Structure

- **Module-based grouping** (auth/, credentials/, assets/) keeps related files together, scales better than type-based grouping for 4-6 resource types.
- **Shared middleware/** stays separate because it is cross-cutting.
- **lib/** holds pure utilities with no Express dependency -- testable in isolation.
- **config/** centralizes all environment-driven configuration with validation at startup (fail fast).

---

## Database Schema Outline

### Core Tables

```prisma
// prisma/schema.prisma

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String
  passwordHash  String    @map("password_hash")
  roleId        String    @map("role_id")
  role          Role      @relation(fields: [roleId], references: [id])
  isActive      Boolean   @default(true) @map("is_active")
  lastLoginAt   DateTime? @map("last_login_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  credentials   Credential[]
  auditLogs     AuditLog[]

  @@map("users")
}

model Role {
  id          String       @id @default(cuid())
  name        String       @unique  // "admin", "manager", "viewer"
  description String?
  permissions Permission[]
  users       User[]
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @updatedAt @map("updated_at")

  @@map("roles")
}

model Permission {
  id       String @id @default(cuid())
  action   String // "credentials:read", "credentials:write", "credentials:reveal"
  roleId   String @map("role_id")
  role     Role   @relation(fields: [roleId], references: [id])

  @@unique([roleId, action])
  @@map("permissions")
}

model Asset {
  id          String       @id @default(cuid())
  name        String       // "Production Server", "company.com domain"
  type        AssetType    // SERVER, DOMAIN, SAAS_ACCOUNT, API_KEY, OTHER
  description String?
  url         String?
  metadata    Json?        // Flexible extra fields
  createdById String       @map("created_by_id")
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @updatedAt @map("updated_at")

  credentials Credential[]

  @@map("assets")
}

model Credential {
  id              String   @id @default(cuid())
  label           String   // "root SSH key", "admin password"
  username        String?
  encryptedValue  String   @map("encrypted_value")  // AES-256-GCM ciphertext
  iv              String   // Initialization vector (unique per encryption)
  authTag         String   @map("auth_tag")          // GCM authentication tag
  keyVersion      Int      @default(1) @map("key_version") // For key rotation
  assetId         String   @map("asset_id")
  asset           Asset    @relation(fields: [assetId], references: [id])
  createdById     String   @map("created_by_id")
  createdBy       User     @relation(fields: [createdById], references: [id])
  rotatedAt       DateTime? @map("rotated_at")
  expiresAt       DateTime? @map("expires_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("credentials")
}

model AuditLog {
  id          String   @id @default(cuid())
  action      String   // "credential.created", "credential.revealed", "user.login"
  entityType  String   @map("entity_type")  // "credential", "user", "asset"
  entityId    String?  @map("entity_id")
  userId      String   @map("user_id")
  user        User     @relation(fields: [userId], references: [id])
  ipAddress   String?  @map("ip_address")
  userAgent   String?  @map("user_agent")
  metadata    Json?    // Additional context (e.g., which fields changed)
  createdAt   DateTime @default(now()) @map("created_at")
  // NO updatedAt -- immutable

  @@index([entityType, entityId])
  @@index([userId])
  @@index([createdAt])
  @@map("audit_logs")
}

enum AssetType {
  SERVER
  DOMAIN
  SAAS_ACCOUNT
  API_KEY
  DATABASE
  OTHER
}
```

### Key Schema Decisions

1. **Credential stores ciphertext + IV + authTag separately** -- required for AES-256-GCM. The `keyVersion` column enables future key rotation without re-encrypting everything at once.
2. **AuditLog has no `updatedAt`** -- it is append-only by design.
3. **Permissions are stored as action strings** (e.g., `credentials:reveal`) linked to roles, enabling fine-grained RBAC without code changes.
4. **Assets are the parent** of credentials -- one asset (e.g., a server) can have many credentials (SSH key, root password, API token).
5. **CUID IDs** instead of UUIDs -- shorter, sortable, no sequential enumeration risk.

### Immutability Enforcement for AuditLog

Apply a PostgreSQL trigger via a Prisma migration:

```sql
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs table is append-only: % operations are forbidden', TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();
```

This ensures even direct SQL access cannot mutate audit records.

---

## Critical Data Flows

### Credential Store Flow

```
Client                    Server                         Database
  |                         |                               |
  |  POST /credentials      |                               |
  |  { label, username,     |                               |
  |    secretValue, assetId}|                               |
  |------------------------>|                               |
  |                         |  1. Auth middleware: verify JWT|
  |                         |  2. RBAC middleware: check     |
  |                         |     "credentials:write"       |
  |                         |  3. Validate input (Zod)      |
  |                         |                               |
  |                         |  4. CryptoService.encrypt()   |
  |                         |     - Generate random IV      |
  |                         |     - Derive DEK from master  |
  |                         |       key + keyVersion        |
  |                         |     - AES-256-GCM encrypt     |
  |                         |     - Return {ciphertext,     |
  |                         |       iv, authTag}            |
  |                         |                               |
  |                         |  5. Store to DB:              |
  |                         |     encryptedValue, iv,       |
  |                         |     authTag, keyVersion       |
  |                         |----------------------------->|
  |                         |                               |
  |                         |  6. Audit middleware logs:     |
  |                         |     "credential.created"      |
  |                         |     (NO plaintext in log)     |
  |                         |----------------------------->|
  |                         |                               |
  |                         |  7. Wipe secretValue from     |
  |                         |     memory (overwrite buffer) |
  |                         |                               |
  |  201 { id, label,       |                               |
  |    username, assetId }  |                               |
  |<------------------------|                               |
  |  (NO secret in response)|                               |
```

**Key security points:**
- The plaintext `secretValue` exists in server memory only during steps 3-7.
- The response NEVER includes the secret value.
- The audit log records the action but NEVER the plaintext.
- The IV is randomly generated per encryption operation (never reused).

### Credential Reveal Flow

```
Client                    Server                         Database
  |                         |                               |
  |  POST /credentials/:id  |                               |
  |       /reveal           |                               |
  |  { reason?: string }    |                               |
  |------------------------>|                               |
  |                         |  1. Auth middleware: verify JWT|
  |                         |  2. RBAC middleware: check     |
  |                         |     "credentials:reveal"      |
  |                         |     (separate from read!)     |
  |                         |                               |
  |                         |  3. Audit log FIRST:          |
  |                         |     "credential.reveal_requested"|
  |                         |     { userId, credentialId,   |
  |                         |       reason, ip, userAgent } |
  |                         |----------------------------->|
  |                         |                               |
  |                         |  4. Fetch credential from DB  |
  |                         |<-----------------------------|
  |                         |                               |
  |                         |  5. CryptoService.decrypt()   |
  |                         |     - Derive DEK from master  |
  |                         |       key + keyVersion        |
  |                         |     - AES-256-GCM decrypt     |
  |                         |       with iv + authTag       |
  |                         |     - Return plaintext        |
  |                         |                               |
  |                         |  6. Return over TLS:          |
  |  200 { secretValue }    |     (plaintext in response)   |
  |<------------------------|                               |
  |                         |                               |
  |                         |  7. Wipe plaintext from memory|
  |                         |                               |
```

**Key security points:**
- `credentials:reveal` is a SEPARATE permission from `credentials:read` (read returns metadata only).
- The audit log is written BEFORE decryption, so even if decryption fails or the server crashes, the attempt is recorded.
- The `reason` field supports compliance (why was this accessed?).
- Plaintext is transmitted only over TLS and never logged server-side.
- No "re-encrypt" is needed -- the ciphertext stays intact in the database.

---

## Encryption Key Management

### Recommended Approach for Self-Hosted Docker

**Architecture: Server-Side Envelope Encryption**

This is not a full zero-knowledge design (which requires client-side encryption). For a server-managed credential vault used by a team, server-side envelope encryption is the practical pattern:

```
MASTER_ENCRYPTION_KEY (env var, 256-bit)
        |
        v
   HKDF derive ---> DEK (Data Encryption Key) per key version
        |
        v
   AES-256-GCM encrypt/decrypt credential values
```

**Layer 1: Master Key**
- A 256-bit random key stored as a hex-encoded environment variable: `MASTER_ENCRYPTION_KEY`
- In Coolify, set this via the environment variables UI (stored encrypted at rest by Coolify)
- Generate with: `openssl rand -hex 32`
- NEVER commit to source control
- Back up securely offline (printed, hardware security module, or sealed envelope)

**Layer 2: Key Derivation (HKDF)**
- Derive a unique Data Encryption Key (DEK) for each `keyVersion` using HKDF-SHA256
- Input: master key + `keyVersion` integer as info parameter
- This allows key rotation: increment `keyVersion`, derive new DEK, new credentials use it
- Old credentials remain decryptable with their stored `keyVersion`

**Layer 3: Per-Value Encryption**
- Each credential value is encrypted with AES-256-GCM
- Unique random IV (96-bit) per encryption operation
- Authentication tag stored alongside ciphertext (prevents tampering)

### Key Rotation Strategy

1. Admin triggers rotation via `POST /admin/rotate-key`
2. Server increments the global `keyVersion`
3. New credentials are encrypted with the new DEK
4. A background job re-encrypts existing credentials with the new key version (optional, can be deferred)
5. Old key versions remain derivable from the master key

### KMS Alternatives (Future Enhancement)

For the current scale (200 users, self-hosted), environment variable master key is acceptable. Future options:
- **HashiCorp Vault Transit** -- use as a KMS to wrap/unwrap the master key without Vault ever seeing credential plaintext
- **SOPS** -- encrypt the master key at rest in the repo using age/GPG
- **Hardware Security Module (HSM)** via PKCS#11 -- highest security, highest cost

---

## RBAC Middleware Architecture

### Permission Model

```
Role (admin, manager, viewer)
  |
  +-- has many Permissions
        |
        +-- "credentials:read"
        +-- "credentials:write"
        +-- "credentials:reveal"
        +-- "credentials:delete"
        +-- "assets:read"
        +-- "assets:write"
        +-- "users:read"
        +-- "users:write"
        +-- "audit:read"
```

### Middleware Implementation Pattern

```typescript
// middleware/authorize.ts
export function authorize(...requiredPermissions: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user; // Set by authenticate middleware

    // Load permissions (cached in memory or Redis)
    const userPermissions = await getPermissionsForRole(user.roleId);

    const hasAll = requiredPermissions.every(
      perm => userPermissions.includes(perm)
    );

    if (!hasAll) {
      throw new ForbiddenError('Insufficient permissions');
    }

    next();
  };
}

// Usage in routes:
router.post('/credentials',
  authenticate,
  authorize('credentials:write'),
  validate(createCredentialSchema),
  credentialController.create
);

router.post('/credentials/:id/reveal',
  authenticate,
  authorize('credentials:reveal'),
  validate(revealCredentialSchema),
  credentialController.reveal
);
```

### Permission Caching

- Load role-permission mappings into an in-memory Map on server startup
- Invalidate cache when roles/permissions are updated (event-based or TTL of 60s)
- At 200 users and a handful of roles, no Redis needed -- in-memory Map is sufficient

---

## Audit Log Architecture

### Non-Bypassable Logging

The audit middleware must be impossible to skip:

**Strategy 1: Prisma Middleware (Recommended)**

```typescript
// Prisma extension that logs all write operations automatically
prisma.$use(async (params, next) => {
  const result = await next(params);

  if (['create', 'update', 'delete'].includes(params.action)) {
    await prisma.auditLog.create({
      data: {
        action: `${params.model}.${params.action}`,
        entityType: params.model,
        entityId: result?.id,
        userId: getCurrentUserId(), // from AsyncLocalStorage context
        metadata: sanitize(params.args), // strip any secret values
      },
    });
  }

  return result;
});
```

**Strategy 2: Express Middleware for Request-Level Auditing**

```typescript
// middleware/audit.ts -- runs AFTER route handler via res.on('finish')
export function auditMiddleware(action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on('finish', async () => {
      if (res.statusCode < 400) { // Only log successful operations
        await prisma.auditLog.create({
          data: {
            action,
            entityType: req.params.resource || 'unknown',
            entityId: req.params.id,
            userId: req.user.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            metadata: { method: req.method, path: req.path },
          },
        });
      }
    });
    next();
  };
}
```

**Strategy 3 (Defense in Depth): PostgreSQL Trigger**

Add triggers on the `credentials` table to automatically insert audit rows for any INSERT/UPDATE/DELETE, regardless of whether the application middleware ran. This catches direct DB access.

### Recommended: Use ALL THREE

- Prisma middleware catches all ORM operations
- Express middleware adds HTTP context (IP, user-agent, reason)
- PostgreSQL trigger is the last-resort safety net

### Retention

- Set a cron job or Prisma script to delete audit logs older than 12 months
- Or better: partition the `audit_logs` table by month and drop old partitions

---

## Prisma Migration Strategy for Docker

### Recommended: Startup Script

```bash
#!/bin/sh
# scripts/start.sh

set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting server..."
node dist/server.js
```

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts

RUN chmod +x scripts/start.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["sh", "scripts/start.sh"]
```

### Why Startup-Time Migrations

- Build-time migrations require DB access during CI/CD -- a security risk
- Startup-time ensures the database schema matches the code version being deployed
- `prisma migrate deploy` is idempotent -- safe to run on every container start
- If migration fails, the container exits and Coolify reports it as unhealthy

---

## Health Check and Readiness Probes

### Implementation

```typescript
// In app.ts or a dedicated health.routes.ts

// Liveness: is the process alive?
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness: can the app serve requests?
app.get('/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`; // DB connectivity check
    res.status(200).json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});
```

### Coolify Configuration

- Use the Docker HEALTHCHECK directive (shown in Dockerfile above)
- Coolify's Traefik integration will only route traffic once the health check passes
- The `/health` endpoint should NOT require authentication
- Keep health endpoints lightweight -- no encryption operations, no heavy queries

---

## Build Order

The following sequence respects dependency chains. Each phase builds on the previous.

### Phase 1: Foundation (must be first)

**What:** Project scaffolding, config, database connection, Prisma schema, Docker setup

- Initialize Node.js + TypeScript project
- Set up Express app with error handling
- Create Prisma schema (all models above)
- Run initial migration
- Dockerfile + docker-compose.yml with PostgreSQL
- Health check endpoints
- Environment variable validation (fail fast on missing `MASTER_ENCRYPTION_KEY`)

**Depends on:** Nothing

### Phase 2: Authentication

**What:** User model operations, JWT auth, login/logout

- Password hashing (bcrypt)
- JWT sign/verify utilities
- `POST /auth/login` and `POST /auth/refresh`
- `authenticate` middleware
- Seed script for initial admin user

**Depends on:** Phase 1 (database, user model)

### Phase 3: RBAC

**What:** Role and permission models, authorization middleware

- Seed default roles (admin, manager, viewer) and permissions
- `authorize()` middleware
- Permission caching (in-memory Map)
- `GET /users`, `POST /users` (admin only)

**Depends on:** Phase 2 (authentication must exist to test authorization)

### Phase 4: Encryption Service

**What:** Core crypto module -- the heart of the vault

- `lib/crypto.ts`: AES-256-GCM encrypt/decrypt
- `lib/keyDerivation.ts`: HKDF key derivation from master key
- Key version tracking
- Unit tests with known test vectors

**Depends on:** Phase 1 (config for master key)

### Phase 5: Credential CRUD + Reveal

**What:** The primary business feature

- `POST /credentials` (encrypt + store)
- `GET /credentials` (metadata only, no secrets)
- `GET /credentials/:id` (metadata only)
- `POST /credentials/:id/reveal` (decrypt + return)
- `PUT /credentials/:id` (re-encrypt with new value)
- `DELETE /credentials/:id` (soft delete or hard delete with audit)

**Depends on:** Phase 3 (RBAC) + Phase 4 (encryption)

### Phase 6: Asset Management

**What:** CRUD for assets that credentials belong to

- `POST /assets`, `GET /assets`, `GET /assets/:id`, `PUT /assets/:id`
- Nested: `GET /assets/:id/credentials`

**Depends on:** Phase 3 (RBAC)

### Phase 7: Audit Logging

**What:** Immutable audit trail

- Prisma middleware for automatic logging
- Express audit middleware for HTTP context
- PostgreSQL trigger for immutability
- `GET /audit-logs` with filtering (by entity, user, date range)
- No DELETE or PUT endpoints for audit logs

**Depends on:** Phase 5 (credential operations to audit) -- but the audit table itself is created in Phase 1

### Phase 8: Hardening and Operations

**What:** Production readiness

- Rate limiting
- Request validation tightening
- Graceful shutdown (SIGTERM handling)
- Structured logging (pino)
- Key rotation endpoint
- Audit log retention job
- Security headers (helmet)
- CORS configuration
- API documentation (OpenAPI/Swagger)

**Depends on:** All previous phases

---

## References

Architecture patterns informed by:
- [Bitwarden Security Whitepaper](https://bitwarden.com/help/bitwarden-security-white-paper/) -- encryption key derivation, zero-knowledge model
- [Bitwarden Encryption Key Derivation](https://bitwarden.com/help/kdf-algorithms/) -- PBKDF2/Argon2 patterns
- [HashiCorp Vault Audit Best Practices](https://developer.hashicorp.com/vault/docs/audit/best-practices) -- audit log architecture
- [Prisma Docker Deployment](https://www.prisma.io/docs/guides/deployment/docker) -- migration strategy
- [Coolify Health Checks](https://coolify.io/docs/knowledge-base/health-checks) -- Traefik integration
- [Immutable Audit Logs in PostgreSQL](https://hoop.dev/blog/immutable-audit-logs-in-postgresql-with-pgcli/) -- append-only trigger pattern
- [Express.js RBAC Middleware](https://gist.github.com/joshnuss/37ebaf958fe65a18d4ff) -- permission guard pattern
- [Prisma Audit Trail Guide](https://medium.com/@arjunlall/prisma-audit-trail-guide-for-postgres-5b09aaa9f75a) -- ORM-level auditing
