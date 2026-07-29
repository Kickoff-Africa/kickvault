# Features Research: Kick Vault

Research into professional credential vault APIs (HashiCorp Vault, 1Password Connect, Bitwarden, AWS Secrets Manager, Azure Key Vault, Keeper, Securden) to benchmark Kick Vault's v1 PRD scope.

---

## Table Stakes

**AES-256 encryption at rest with per-credential encryption** — Every professional vault encrypts secrets at the application layer before storage. The PRD covers this. The critical detail: use a key derivation function (e.g., PBKDF2, Argon2) to derive encryption keys from the master password, never store the master key directly. Industry standard is envelope encryption: a data encryption key (DEK) per credential, wrapped by a key encryption key (KEK) derived from the master password.

**Zero plaintext in logs or error responses** — HashiCorp Vault will refuse to serve requests it cannot audit-log, and it HMAC-hashes all secret values in audit logs so plaintext never appears anywhere. Kick Vault must ensure error handlers, stack traces, and logs never leak credential values.

**Immutable append-only audit log** — Every professional vault logs all access events immutably. The PRD covers this. Standard fields: timestamp, actor (userId), action (REVEAL/CREATE/UPDATE/DELETE), resource (credentialId/assetId), IP address, user agent, and outcome (success/failure). Failed access attempts must also be logged.

**Role-based access control enforced at every endpoint** — Bitwarden, Keeper, and Azure Key Vault all enforce RBAC on every operation. The PRD's four roles (SUPER_ADMIN, Manager, Member, Viewer) are a reasonable starting point for an internal tool at this scale.

**Session management with inactivity timeout** — The PRD covers 15-minute inactivity timeout. Standard pattern: issue a JWT or opaque session token on login, validate on every request, and expire after inactivity. Store session server-side (not just JWT expiry) so sessions can be revoked immediately on role change or deactivation.

**Account lockout after failed login attempts** — The PRD covers 5 attempts. Standard addition: exponential backoff or timed lockout (e.g., 15 minutes) rather than permanent lock, plus notification to admins on lockout events.

**TLS 1.2+ enforcement in transit** — Non-negotiable for any credential API. The PRD mentions this in constraints.

**Input validation and request sanitisation** — Every endpoint must validate and sanitise inputs. SQL injection, XSS in stored metadata, and malformed JSON must be handled. This is implicit but the PRD does not call it out explicitly.

**Credential masking by default** — The PRD covers masked-by-default with explicit reveal. This matches 1Password, Bitwarden, and every major vault: secrets are never returned in list/detail responses unless explicitly requested through a separate reveal action.

---

## Differentiators

**Collection/folder-based credential grouping** — Bitwarden uses "Collections", 1Password uses "Vaults within vaults", Keeper uses "Shared Folders". Beyond the PRD's 4 asset categories, allowing users to organise credentials into logical groups (e.g., by project, client, environment) adds real operational value. For v1, even a simple tagging system or a `group` field on credentials would help.

**Credential type schemas** — Professional vaults support structured credential types beyond username/password:
- **Login**: username + password + URL + TOTP seed
- **API Key**: key + secret + base URL + environment
- **SSH Key**: private key + public key + passphrase + host
- **Certificate**: cert body + private key + chain + expiry date + issuer
- **Database**: host + port + database + username + password + connection string
- **Secure Note**: freeform encrypted text
- **Wi-Fi**: SSID + password + encryption type

Each type has a defined schema with required/optional fields. This helps with validation, search, and expiry tracking. The PRD mentions "4 categories" but does not specify whether credentials have structured type schemas.

**Cursor-based pagination for audit logs** — At scale, offset-based pagination degrades. GitHub's audit log API and HashiCorp Vault both use cursor-based pagination. Standard pattern: return a `nextCursor` token and accept `cursor` + `limit` query parameters. For 200 users generating audit events over 12 months, cursor-based pagination prevents performance degradation.

**Bulk operations** — For credential migration and onboarding, supporting batch create/update operations is a differentiator. 1Password Connect supports batch item operations.

**Credential sharing with time-limited access** — HashiCorp Vault's response wrapping pattern: issue a single-use, TTL-bound token that grants access to a specific credential. The recipient unwraps once, and the token is destroyed. This is more sophisticated than the PRD's "secure reveal" concept and useful for sharing credentials with external parties or temporary team members.

**Webhook/event notifications** — Notify external systems (Slack, email) when credentials are about to expire, when suspicious access patterns are detected, or when high-sensitivity credentials are revealed. The PRD defers this to v2, which is reasonable.

**API versioning from day one** — Prefix all routes with `/api/v1/`. HashiCorp Vault and Azure Key Vault both version their APIs. Costs nothing to implement now but saves pain later.

---

## Anti-Features (Don't Build in v1)

**Dynamic secret generation** — HashiCorp Vault's killer feature: generating ephemeral database credentials, cloud IAM keys, etc. on demand. This requires integrating with external systems (AWS, databases) and is massive scope. Defer entirely.

**Secret rotation automation** — AWS Secrets Manager can automatically rotate credentials on a schedule. This requires deep integration with target systems. The PRD correctly defers this.

**SSO/OAuth/SAML integration** — The PRD correctly puts this in v2. For 200 internal users, master password auth is sufficient for v1.

**Browser extension / auto-fill** — The PRD correctly defers this. It is a frontend concern and a large attack surface.

**Multi-tenancy / organisation hierarchy** — Kick Vault serves one organisation. Do not build multi-tenant architecture.

**End-to-end encryption (client-side)** — True zero-knowledge architecture where the server never sees plaintext requires client-side encryption/decryption. This complicates the API significantly (server cannot search encrypted fields, cannot validate credential formats). For an internal tool, server-side encryption with strict access controls is the pragmatic choice for v1.

**Secrets versioning / history** — HashiCorp Vault KV v2 keeps version history of secrets. Useful but adds storage complexity and raises questions about whether old credential values should be recoverable. Defer to v2.

**CSV import/export** — The PRD correctly defers migration tooling. For v1, credentials will be entered manually or via API.

**IP allowlisting** — The PRD defers admin settings including IP allowlisting. For a self-hosted internal tool behind a VPN/firewall, this is less critical for v1.

---

## Gaps vs PRD

**Structured credential type schemas** — The PRD mentions "4 categories" for assets but does not specify credential types. Professional vaults distinguish between login credentials, API keys, SSH keys, certificates, and secure notes, each with a defined field schema. Without this, the vault becomes a glorified key-value store. At minimum, define a `type` enum on credentials with type-specific metadata fields (e.g., `expiresAt` for API keys and certificates).

**Expiry date tracking with configurable thresholds** — The PRD mentions "expiring soon" for dashboard stats but does not define what this means or how it works. Industry standard thresholds: 60 days (info), 30 days (warning), 7 days (critical), expired (alert). Credentials and assets need an optional `expiresAt` field, and the API needs a query endpoint like `GET /credentials?expiring_within=30d`. Without this, the "expiring soon" dashboard stat has no data source.

**Secure reveal implementation details** — The PRD says "decrypt on authorised request" but does not specify the mechanism. Professional patterns:
1. **Separate endpoint**: `POST /credentials/:id/reveal` returns the decrypted value, distinct from `GET /credentials/:id` which returns masked data.
2. **Short-lived reveal token**: The reveal endpoint returns a time-limited token (e.g., 30-60 seconds TTL) that can be exchanged once for the plaintext. After TTL or first use, the token is invalidated.
3. **Rate limiting on reveals**: Limit reveal frequency per user per credential (e.g., max 10 reveals per minute) to detect credential harvesting.
4. **Every reveal is audit-logged**: Actor, credential, timestamp, IP — no exceptions.

**Resource-level permissions (not just role-level)** — The PRD defines 4 global roles, but professional vaults also support per-resource permissions. Example: a Manager might have full access to "Production API Keys" but only read access to "HR Credentials". Bitwarden achieves this with collection-level permissions; Azure Key Vault with resource-scope RBAC. For v1, consider at minimum: credential-level `visibility` (who can see it) and asset-level `accessList` (which roles/users can access). Even a simple "owner" field that restricts non-admin access would add meaningful security.

**Health check endpoint** — Standard for any internal API deployed via Docker/Coolify. At minimum:
- `GET /health` — returns `{ "status": "ok", "version": "1.0.0", "uptime": 12345 }`
- `GET /health/ready` — checks database connectivity, encryption service availability
This is used by container orchestrators for liveness/readiness probes. The PRD does not mention this.

**Rate limiting on all endpoints** — The PRD does not mention rate limiting beyond login lockout. Professional APIs enforce rate limits globally (e.g., 100 req/min per user) and per-sensitive-endpoint (e.g., 10 reveals/min). Without this, a compromised session token could exfiltrate all credentials before anyone notices.

**Search and filtering for credentials at scale** — The PRD does not mention search capabilities. Standard patterns:
- `GET /credentials?search=aws&type=API_KEY&status=ACTIVE` — full-text search on name/description + filter by type/status
- `GET /assets?category=SOFTWARE&status=ACTIVE&sort=expiresAt&order=asc` — filter + sort
- For 10,000 records, database-level full-text search (PostgreSQL `tsvector`) or simple `ILIKE` queries are sufficient. Do not build Elasticsearch.

**Soft delete with retention period** — The PRD mentions DELETE but not whether it is hard or soft delete. Professional vaults use soft delete: mark as deleted, retain for a configurable period (e.g., 30 days), then hard delete. This prevents accidental permanent loss and supports compliance (audit trail references deleted items).

**Force logout / session revocation** — The PRD mentions session management but not the ability for admins to forcibly terminate another user's sessions. When an employee is offboarded or a device is compromised, SUPER_ADMIN must be able to revoke all active sessions for a user immediately.

**Password strength validation on credential creation** — Not for stored credentials (those are whatever the external system uses), but for the master password and any user account passwords. Enforce minimum complexity: length, character classes, or zxcvbn-style strength scoring.

**CORS configuration** — Since this is an API that will eventually have a frontend consumer, CORS headers must be configurable. The PRD does not mention this, but it is essential for any frontend integration.

**Request ID / correlation ID on every response** — Standard for internal APIs: return a unique `X-Request-Id` header on every response. This enables tracing audit log entries back to specific API calls and simplifies debugging.

---

## API Design Patterns

### Endpoint Naming Conventions

Follow REST conventions used by professional vault APIs:

```
# Authentication
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/refresh

# Users
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/:id
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id

# Assets
GET    /api/v1/assets
POST   /api/v1/assets
GET    /api/v1/assets/:id
PATCH  /api/v1/assets/:id
DELETE /api/v1/assets/:id

# Credentials (nested under assets or standalone)
GET    /api/v1/credentials
POST   /api/v1/credentials
GET    /api/v1/credentials/:id          # Returns masked
PATCH  /api/v1/credentials/:id
DELETE /api/v1/credentials/:id
POST   /api/v1/credentials/:id/reveal   # Returns decrypted (audit-logged)

# Audit Logs (read-only, cursor-paginated)
GET    /api/v1/audit-logs?cursor=xxx&limit=50&action=REVEAL&userId=xxx

# Dashboard
GET    /api/v1/dashboard/stats

# Health
GET    /api/v1/health
GET    /api/v1/health/ready
```

### Response Shape Convention

Standard envelope pattern used by internal APIs:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": { "cursor": "abc123", "limit": 50, "hasMore": true },
    "total": 1234
  },
  "requestId": "req_abc123"
}
```

Error responses:

```json
{
  "success": false,
  "error": {
    "code": "CREDENTIAL_NOT_FOUND",
    "message": "Credential with ID xyz does not exist",
    "status": 404
  },
  "requestId": "req_abc123"
}
```

### Credential Masking Pattern

On list/detail endpoints, credential secrets are replaced:

```json
{
  "id": "cred_123",
  "name": "AWS Production Key",
  "type": "API_KEY",
  "fields": {
    "key": "AKIA****WXYZ",
    "secret": "••••••••"
  },
  "expiresAt": "2026-12-01T00:00:00Z",
  "status": "ACTIVE"
}
```

The reveal endpoint returns the full plaintext only on `POST /credentials/:id/reveal`, which is a POST (not GET) because it has side effects (audit logging, rate limit consumption).

### Pagination Pattern for Audit Logs

Cursor-based, not offset-based:

```
GET /api/v1/audit-logs?limit=50
  -> returns { data: [...], meta: { page: { cursor: "eyJ...", hasMore: true } } }

GET /api/v1/audit-logs?limit=50&cursor=eyJ...
  -> returns next page
```

Filterable by: `action`, `userId`, `resourceType`, `resourceId`, `dateFrom`, `dateTo`.

### Expiry Tracking Pattern

Credentials and assets with an `expiresAt` field. Dashboard endpoint aggregates:

```json
{
  "totalAssets": 342,
  "totalCredentials": 891,
  "expiringSoon": {
    "within7Days": 3,
    "within30Days": 12,
    "within60Days": 28,
    "expired": 5
  }
}
```

`GET /credentials?expiring_within=30d` returns credentials expiring in the next 30 days, sorted by expiry date ascending.

---

*Research conducted 2026-07-29. Sources: HashiCorp Vault API docs, 1Password Connect API, Bitwarden access control documentation, AWS Secrets Manager best practices, Azure Key Vault RBAC guide, Securden/Keeper feature documentation, industry blog posts on secrets management patterns.*
