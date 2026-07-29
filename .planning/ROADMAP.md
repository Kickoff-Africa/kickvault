# Roadmap: Kick Vault

## Overview

Kick Vault delivers a secure, encrypted REST API for credential and asset governance in 8 phases. The build starts with project foundation and schema, progresses through authentication, user management, per-resource ACLs, encrypted credential vault, and asset management, then layers on immutable audit logging, and finishes with dashboard aggregation, search, and production hardening. Every phase delivers a coherent, verifiable capability that unblocks the next.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Schema** - Project scaffolding, Prisma schema, Docker, health checks, crypto module
- [x] **Phase 2: Authentication** - Login, JWT sessions, lockout, logout, password reset
- [x] **Phase 3: User Management & RBAC** - User invites, role enforcement, deactivation, password change
- [ ] **Phase 4: Per-Resource ACLs** - Explicit access lists on credentials and assets, grant/revoke endpoints
- [ ] **Phase 5: Credential Vault** - Encrypted credential CRUD, masked responses, secure reveal, expiry tracking
- [ ] **Phase 6: Asset Management** - Asset CRUD, categories, status state machine, access-scoped operations
- [ ] **Phase 7: Audit Logging** - Immutable append-only audit log, cursor pagination, filtering, CSV export
- [ ] **Phase 8: Dashboard, Search & Hardening** - Stats aggregation, search/filter endpoints, production hardening

## Phase Details

### Phase 1: Foundation & Schema
**Goal**: A running Express + TypeScript server with complete Prisma schema, health checks, Docker deployment, and the encryption module — the foundation everything else builds on
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. `GET /health` returns 200 with uptime info on a running server
  2. `GET /health/ready` returns 200 when PostgreSQL is connected, 503 when it is not
  3. `docker compose up` starts the API and PostgreSQL with zero manual steps
  4. Prisma migrations run automatically on container startup and the full schema (all models) is applied
  5. The encryption module can encrypt and decrypt a test value using AES-256-GCM with envelope encryption, producing different ciphertext for the same plaintext on each call
**Plans**: 3 plans in 2 waves

Plans:
- [x] 01-01-PLAN.md — Project scaffold (npm init, dependencies, TypeScript config, Express app, health endpoints, Pino logger, Zod env config)
- [x] 01-02-PLAN.md — Complete Prisma schema (all 7 models, 4 enums for all 8 phases)
- [x] 01-03-PLAN.md — Envelope encryption module (TDD) + Docker deployment (Dockerfile, docker-compose, auto-migrations)

### Phase 2: Authentication
**Goal**: Users can securely log in, maintain sessions, and recover access — with brute-force protection built in from day one
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**Success Criteria** (what must be TRUE):
  1. User can log in with email and master password, receiving JWT access and refresh tokens
  2. After 5 consecutive failed login attempts, the account is locked and further attempts are rejected
  3. Sessions expire after 15 minutes of inactivity and the expired token is rejected
  4. User can log out, and all their session tokens become invalid immediately
  5. User can request a password reset link via email and set a new password using the link
**Plans**: 2 plans in 2 waves

Plans:
- [x] 02-01-PLAN.md — Auth infrastructure (schema migration, env config, token/password/email services, authenticate middleware)
- [x] 02-02-PLAN.md — Auth module (login, logout, refresh, forgot-password, reset-password endpoints + integration tests)

### Phase 3: User Management & RBAC
**Goal**: SUPER_ADMIN can manage the user population and the four-role permission system is enforced on every endpoint
**Depends on**: Phase 2
**Requirements**: USER-01, USER-02, USER-03, USER-04
**Success Criteria** (what must be TRUE):
  1. SUPER_ADMIN can invite a new user by email with a role assigned at invite time
  2. SUPER_ADMIN can deactivate a user, immediately revoking all their active sessions
  3. Every endpoint enforces role-based access — a Viewer cannot call a Manager-only endpoint
  4. User can change their own password while logged in
**Plans**: 3 plans in 3 waves

Plans:
- [x] 03-01-PLAN.md — Phase 3 infrastructure (schema migration, ConflictError, token/email helpers, requireRole middleware, loginUser mustChangePassword)
- [x] 03-02-PLAN.md — Users module (validation, service, controller, routes with RBAC enforcement)
- [x] 03-03-PLAN.md — Integration tests for all USER requirements (invite, deactivate, RBAC, password change)

### Phase 4: Per-Resource ACLs
**Goal**: Every credential and asset has an explicit access list — users can only access resources they have been specifically granted permission to
**Depends on**: Phase 3
**Requirements**: ACL-01, ACL-02, ACL-03, ACL-04
**Success Criteria** (what must be TRUE):
  1. Each credential has an access list that maps specific users to permission levels
  2. Each asset has an access list that maps specific users to permission levels
  3. SUPER_ADMIN and Manager can grant or revoke a user's access to any credential
  4. SUPER_ADMIN and Manager can grant or revoke a user's access to any asset
  5. A user without explicit access to a resource receives 403 when attempting to access it
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: Credential Vault
**Goal**: Authorised users can store, retrieve, edit, and delete credentials — with secrets encrypted at rest and only revealed through a controlled, rate-limited, audit-logged flow
**Depends on**: Phase 4
**Requirements**: CRED-01, CRED-02, CRED-03, CRED-04, CRED-05, CRED-06
**Success Criteria** (what must be TRUE):
  1. User can create a credential (Friendly Name, System/Host, Username, Secret) and the secret is stored encrypted — never as plaintext in the database
  2. All credential API responses mask the secret field by default — no endpoint leaks plaintext
  3. Authorised user can reveal a credential secret via `POST /credentials/:id/reveal`, rate-limited to 10 requests per minute per user
  4. User can edit and delete credentials they have explicit access to
  5. Credentials support an optional `expiresAt` date for renewal tracking
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD
- [ ] 05-03: TBD

### Phase 6: Asset Management
**Goal**: Authorised users can manage the organisation's asset inventory with enforced categories and status transition rules
**Depends on**: Phase 4
**Requirements**: ASSET-01, ASSET-02, ASSET-03, ASSET-04
**Success Criteria** (what must be TRUE):
  1. User can create an asset with Asset ID (unique), Name, Category, Status, and optional Location/Notes
  2. Assets enforce exactly 4 categories: Hardware, Software, Digital, Intangible
  3. Asset status transitions follow enforced rules — Retired is terminal (admin override required), invalid transitions are rejected with a clear error
  4. User can view, edit, and delete assets they have explicit access to
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Audit Logging
**Goal**: Every security-relevant action is automatically logged and the log is provably immutable — no one, including SUPER_ADMIN, can alter history
**Depends on**: Phase 5, Phase 6
**Requirements**: AUDIT-01, AUDIT-02, AUDIT-03, AUDIT-04, AUDIT-05, AUDIT-06
**Success Criteria** (what must be TRUE):
  1. All REVEAL, CREATE, EDIT, DELETE actions on credentials and assets are automatically logged with User ID, action type, target type, target ID, and timestamp
  2. No API endpoint, Prisma operation, or direct SQL statement can modify or delete an audit log entry — enforced at both application and database layers
  3. Audit log API returns entries cursor-paginated, newest-first
  4. Audit log endpoint supports filtering by action type, user ID, and date range
  5. SUPER_ADMIN can export audit logs as a CSV file
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD
- [ ] 07-03: TBD

### Phase 8: Dashboard, Search & Hardening
**Goal**: The API provides aggregated stats, search/filter capabilities, and is hardened for production deployment
**Depends on**: Phase 7
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05
**Success Criteria** (what must be TRUE):
  1. Dashboard stats endpoint returns total assets count, total credentials count, and expiring-soon count (configurable threshold, default 30 days)
  2. Dashboard endpoint returns a recent audit activity feed (last 10 events)
  3. Credentials can be searched by Friendly Name and System/Host, and filtered by expiry window
  4. Assets can be searched by Name and Asset ID
  5. API responses complete within 2 seconds under normal load, search responses within 500ms
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 & 6 (parallel possible) -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Schema | 3/3 | Complete | 2026-07-29 |
| 2. Authentication | 2/2 | Complete | 2026-07-29 |
| 3. User Management & RBAC | 3/3 | Complete | 2026-07-29 |
| 4. Per-Resource ACLs | 0/2 | Not started | - |
| 5. Credential Vault | 0/3 | Not started | - |
| 6. Asset Management | 0/2 | Not started | - |
| 7. Audit Logging | 0/3 | Not started | - |
| 8. Dashboard, Search & Hardening | 0/2 | Not started | - |
