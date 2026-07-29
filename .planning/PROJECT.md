# Kick Vault

## What This Is

Kick Vault is Kickoff Africa's internal Asset and Credential Governance Platform (KACGP) — a secure, encrypted REST API backend for storing, organising, and controlling access to sensitive digital and physical assets including passwords, API keys, software licences, SSH keys, certificates, and hardware inventory. It replaces ad-hoc credential sharing via WhatsApp and spreadsheets with one auditable, role-enforced system.

## Core Value

Every credential stored in Kick Vault is encrypted at rest, accessible only to authorised users, and every access is logged — replacing zero accountability with total traceability.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Authenticated API with master password login, session management, and account lockout after 5 failed attempts
- [ ] Four-role RBAC: SUPER_ADMIN, Manager, Member, Viewer — enforced on every endpoint
- [ ] Asset management: create, read, update, delete assets with category, status, location/notes
- [ ] Credential vault: store credentials with AES-256 encryption at rest; server never holds plaintext
- [ ] Secure reveal: decrypt and return credential secret on authorised request only
- [ ] Immutable audit log: every REVEAL, CREATE, EDIT, DELETE action auto-logged server-side
- [ ] Dashboard stats API: total assets, total credentials, expiring soon count
- [ ] User management: SUPER_ADMIN can invite users by email, assign roles, deactivate accounts
- [ ] Containerised for Coolify/Docker deployment with PostgreSQL

### Out of Scope

- Frontend/UI — backend API only for v1
- Browser extension and auto-fill — v2
- Biometric / 2FA authentication — v2
- CSV import or migration from 1Password/LastPass — v2
- Credential expiry notifications — v2
- SSO / OAuth — v2
- REST webhooks and CI/CD secret injection — v2
- Admin settings panel (password policy, IP allowlist) — v2

## Context

- **Organisation:** Kickoff Africa (internal use only, ~200 users max)
- **Problem being solved:** Credentials scattered across WhatsApp, plain-text notes, and spreadsheets — no audit trail, no offboarding visibility, no central record
- **PRD version:** 1.0 (10 July 2026) — defines full functional and non-functional requirements
- **Target scale:** Up to 200 users and 10,000 assets/credentials without architectural changes
- **Log retention:** Audit logs must be retained for minimum 12 months
- **Data residency:** All data must remain within Kickoff Africa's approved infrastructure (Coolify self-hosted)

## Constraints

- **Tech Stack:** Node.js + TypeScript + Express + Prisma ORM + PostgreSQL — decided by owner
- **Deployment:** Docker container, hosted on Coolify — all data stays self-hosted
- **Security:** AES-256 encryption at rest; TLS 1.2+ in transit; zero plaintext server-side at any point in request lifecycle
- **Performance:** API responses under 2 seconds; search under 500ms
- **Auth lockout:** 5 failed login attempts triggers account lock (configurable duration)
- **Session timeout:** 15 minutes inactivity (configurable by admin)
- **Availability:** 99.5% uptime during business hours

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Backend-only for v1 | Ship the secure core first; frontend can consume the API later | — Pending |
| Express over Fastify/Hono | Owner preference and team familiarity | — Pending |
| Prisma ORM | Type-safe DB access, clean migrations, pairs well with TypeScript | — Pending |
| AES-256 encryption at application layer | Zero-knowledge server — plaintext never stored or logged | — Pending |
| Immutable audit log (no delete endpoint) | Compliance and accountability requirement from PRD | — Pending |
| Coolify/Docker deployment | Self-hosted data residency requirement from Kickoff Africa | — Pending |

---
*Last updated: 2026-07-29 after initialization*
