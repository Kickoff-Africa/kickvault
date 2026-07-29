# Phase 3: User Management & RBAC - Context

**Gathered:** 2026-07-29
**Status:** Ready for planning

<domain>
## Phase Boundary

SUPER_ADMIN can invite users (with role), deactivate users, and update roles. The four-role permission system (SUPER_ADMIN, MANAGER, MEMBER, VIEWER) is enforced on every API endpoint via middleware. Users can change their own password. Credential/asset CRUD and per-resource ACLs are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Invite flow
- Temporary password generated and sent in the invite email (not a magic link)
- Invited user's `mustChangePassword` flag is set to `true` on invite creation
- On first login, the login response includes `mustChangePassword: true` — client is responsible for gating further actions; server does NOT block other endpoints
- After changing password from invite flow, `mustChangePassword` clears to `false`
- SUPER_ADMIN can resend an invite (re-generates token, sends fresh email, invalidates old token)
- Invite token expiry: 7 days, configurable via env var (INVITE_TOKEN_EXPIRY_DAYS)
- Invite token stored as SHA-256 hash on User (same pattern as reset tokens in Phase 2)

### RBAC enforcement
- `requireRole(...roles)` middleware per route — each route explicitly declares which roles are allowed
- SUPER_ADMIN always passes all role checks automatically (no need to list in every requireRole call)
- Role access model for this phase and downstream phases:
  - VIEWER: read-only access to resources they have explicit ACL access to
  - MEMBER: read + write on resources with explicit ACL access
  - MANAGER: full CRUD + can grant/revoke ACL access to resources
  - SUPER_ADMIN: everything, no restrictions
- Role check failures always return `403 Forbidden` with no reason disclosed (prevents role enumeration)
- `requireRole` middleware goes after `authenticate` middleware in route chain

### Role management
- SUPER_ADMIN can update any user's role at any time via PATCH /users/:id
- SUPER_ADMIN cannot deactivate or demote another SUPER_ADMIN (SUPER_ADMINs are protected from each other)
- Last-SUPER_ADMIN safeguard: if deactivating or role-changing a user would leave zero active SUPER_ADMINs, the request is rejected with 409 Conflict
- Deactivating a user immediately deletes ALL their active sessions (instant revocation, meets USER-02)

### Password change (own password)
- `POST /users/me/password` requires `{ currentPassword, newPassword }`
- Current password must be verified with Argon2id before accepting the change
- On successful change: all sessions EXCEPT the current one are deleted (current session stays active)
- `mustChangePassword` flag is cleared to `false` after a successful password change

</decisions>

<specifics>
## Specific Ideas

- Invite email should include: the temporary password, the login URL, and clear instructions that the password must be changed on first login
- The `mustChangePassword` enforcement is client-side by design — the API returns the flag on login and trusts the client to enforce the gate. This keeps the server simple.
- SUPER_ADMIN self-protection rule: a SUPER_ADMIN cannot deactivate themselves or change their own role to a lesser role (prevent accidental self-lockout)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-user-management-and-rbac*
*Context gathered: 2026-07-29*
