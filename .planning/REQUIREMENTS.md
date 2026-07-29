# Requirements: Kick Vault

**Defined:** 2026-07-29
**Core Value:** Every credential is encrypted at rest, accessible only to explicitly authorised users, and every access is logged immutably — replacing zero accountability with total traceability.

## v1 Requirements

### Authentication

- [x] **AUTH-01**: User can log in with email and master password, receiving JWT access + refresh tokens
- [x] **AUTH-02**: Account locks after 5 consecutive failed login attempts (lockout stored in DB, not in memory)
- [x] **AUTH-03**: Sessions auto-expire after 15 minutes of inactivity (configurable via env)
- [x] **AUTH-04**: User can log out, invalidating all current session tokens
- [x] **AUTH-05**: User can reset password via a verified email link

### User Management

- [x] **USER-01**: SUPER_ADMIN can invite a user by email and assign a role at invite time
- [x] **USER-02**: SUPER_ADMIN can deactivate a user account, immediately revoking all active sessions
- [x] **USER-03**: System enforces 4 roles: SUPER_ADMIN, Manager, Member, Viewer with RBAC on all endpoints
- [x] **USER-04**: User can update their own password

### Access Control (Per-Resource ACLs)

- [ ] **ACL-01**: Each credential has an explicit access list associating users with their permission level
- [ ] **ACL-02**: Each asset has an explicit access list associating users with their permission level
- [ ] **ACL-03**: SUPER_ADMIN and Manager can grant or revoke user access on any credential
- [ ] **ACL-04**: SUPER_ADMIN and Manager can grant or revoke user access on any asset

### Credential Vault

- [ ] **CRED-01**: Authorised user can store a credential (Friendly Name, System/Host, Username, Secret) — secret encrypted with AES-256-GCM at rest
- [ ] **CRED-02**: Server never stores, logs, or transmits plaintext secret values at any point in the request lifecycle
- [ ] **CRED-03**: All credential API responses mask the secret field by default
- [ ] **CRED-04**: Authorised user can reveal a credential secret via `POST /credentials/:id/reveal` — rate-limited (10/min/user), audit-logged before decryption
- [ ] **CRED-05**: Authorised user can edit and delete credentials they have explicit access to
- [ ] **CRED-06**: Credentials support an optional expiry date (`expiresAt`) for tracking upcoming renewals

### Asset Management

- [ ] **ASSET-01**: Authorised user can create an asset with Asset ID (required, unique), Name, Category, Status, and optional Location/Notes
- [ ] **ASSET-02**: Assets have 4 categories: Hardware, Software, Digital, Intangible
- [ ] **ASSET-03**: Asset status follows enforced transition rules: Active → Maintenance/Retired/Lost; Maintenance → Active; Lost → Active/Retired; Retired is terminal (admin override required)
- [ ] **ASSET-04**: Authorised user can view, edit, and delete assets they have explicit access to

### Audit Logs

- [ ] **AUDIT-01**: All REVEAL, CREATE, EDIT, DELETE actions on credentials and assets are auto-logged server-side with User ID, action type, target type, target ID, and timestamp
- [ ] **AUDIT-02**: Audit log entries are immutable — no user (including SUPER_ADMIN) can modify or delete any entry
- [ ] **AUDIT-03**: Audit log immutability is enforced at both application layer (Prisma middleware) and database layer (PostgreSQL trigger rejecting UPDATE/DELETE on audit_logs)
- [ ] **AUDIT-04**: Audit log API returns entries cursor-paginated, newest-first
- [ ] **AUDIT-05**: Audit log endpoint supports filtering by action type, user ID, and date range
- [ ] **AUDIT-06**: SUPER_ADMIN can export audit logs as a CSV file

### Dashboard & Search

- [ ] **DASH-01**: Dashboard stats endpoint returns total assets count, total credentials count, and expiring-soon count (configurable threshold, default 30 days)
- [ ] **DASH-02**: Dashboard endpoint returns recent audit activity feed (last 10 events)
- [ ] **DASH-03**: Credentials endpoint supports search by Friendly Name and System/Host (PostgreSQL ILIKE)
- [ ] **DASH-04**: Assets endpoint supports search by Name and Asset ID (PostgreSQL ILIKE)
- [ ] **DASH-05**: Credentials endpoint supports filtering by expiry window (`?expiring_within=30d`)

### Infrastructure

- [ ] **INFRA-01**: API exposes `GET /health` (liveness) and `GET /health/ready` (DB connectivity check) — unauthenticated, required by Coolify
- [ ] **INFRA-02**: Application runs as a Docker container deployable on Coolify with PostgreSQL
- [ ] **INFRA-03**: Prisma migrations execute automatically on container startup

## v2 Requirements

### Authentication
- **AUTH-V2-01**: Two-factor authentication (TOTP / biometric)
- **AUTH-V2-02**: SSO / OAuth (Google, Microsoft)

### Credential Vault
- **CRED-V2-01**: Credential secret versioning (history of previous values)
- **CRED-V2-02**: Dynamic secret generation and automatic rotation
- **CRED-V2-03**: Import from CSV, 1Password, LastPass
- **CRED-V2-04**: Credential expiry email/push notifications

### Administration
- **ADMIN-V2-01**: Admin settings panel (password policy, session policy, IP allowlist)
- **ADMIN-V2-02**: REST API webhooks for external integrations
- **ADMIN-V2-03**: CI/CD pipeline secret injection endpoints

### Platform
- **PLAT-V2-01**: Browser extension with auto-fill capability

## Out of Scope

| Feature | Reason |
|---------|--------|
| Frontend / UI | Backend API only for v1 — frontend consumes this API |
| CSV import | Deferred to v2; migration path not needed at launch |
| SSO / OAuth | Email/password sufficient for internal team at this scale |
| 2FA / biometric | Deferred to v2; not blocking initial rollout |
| Browser extension | Deferred to v2 |
| Credential type schemas (Login, API Key, SSH Key, etc.) | User chose generic credentials for v1 simplicity |
| Credential rotation / dynamic secrets | High complexity, deferred to v2 |
| Webhook integrations | Not needed for internal tool at v1 scale |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1: Foundation & Schema | Complete |
| INFRA-02 | Phase 1: Foundation & Schema | Complete |
| INFRA-03 | Phase 1: Foundation & Schema | Complete |
| AUTH-01 | Phase 2: Authentication | Complete |
| AUTH-02 | Phase 2: Authentication | Complete |
| AUTH-03 | Phase 2: Authentication | Complete |
| AUTH-04 | Phase 2: Authentication | Complete |
| AUTH-05 | Phase 2: Authentication | Complete |
| USER-01 | Phase 3: User Management & RBAC | Complete |
| USER-02 | Phase 3: User Management & RBAC | Complete |
| USER-03 | Phase 3: User Management & RBAC | Complete |
| USER-04 | Phase 3: User Management & RBAC | Complete |
| ACL-01 | Phase 4: Per-Resource ACLs | Pending |
| ACL-02 | Phase 4: Per-Resource ACLs | Pending |
| ACL-03 | Phase 4: Per-Resource ACLs | Pending |
| ACL-04 | Phase 4: Per-Resource ACLs | Pending |
| CRED-01 | Phase 5: Credential Vault | Pending |
| CRED-02 | Phase 5: Credential Vault | Pending |
| CRED-03 | Phase 5: Credential Vault | Pending |
| CRED-04 | Phase 5: Credential Vault | Pending |
| CRED-05 | Phase 5: Credential Vault | Pending |
| CRED-06 | Phase 5: Credential Vault | Pending |
| ASSET-01 | Phase 6: Asset Management | Pending |
| ASSET-02 | Phase 6: Asset Management | Pending |
| ASSET-03 | Phase 6: Asset Management | Pending |
| ASSET-04 | Phase 6: Asset Management | Pending |
| AUDIT-01 | Phase 7: Audit Logging | Pending |
| AUDIT-02 | Phase 7: Audit Logging | Pending |
| AUDIT-03 | Phase 7: Audit Logging | Pending |
| AUDIT-04 | Phase 7: Audit Logging | Pending |
| AUDIT-05 | Phase 7: Audit Logging | Pending |
| AUDIT-06 | Phase 7: Audit Logging | Pending |
| DASH-01 | Phase 8: Dashboard, Search & Hardening | Pending |
| DASH-02 | Phase 8: Dashboard, Search & Hardening | Pending |
| DASH-03 | Phase 8: Dashboard, Search & Hardening | Pending |
| DASH-04 | Phase 8: Dashboard, Search & Hardening | Pending |
| DASH-05 | Phase 8: Dashboard, Search & Hardening | Pending |

**Coverage:**
- v1 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0

---
*Requirements defined: 2026-07-29*
*Last updated: 2026-07-29 after roadmap creation*
