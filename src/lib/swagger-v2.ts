/**
 * OpenAPI additions for the Locker Room v2 design: expanded assets/credentials/audit logs/users,
 * teams, requests, settings, API keys, alert rules, webhooks and integrations.
 * Merged over the base spec in swagger.ts; a path defined here replaces the base definition.
 */

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errors = {
  401: { $ref: '#/components/responses/Unauthorized' },
  403: { $ref: '#/components/responses/Forbidden' },
};
const json = (schema: Json) => ({ 'application/json': { schema } });
const obj = (properties: Json, required?: string[]) => ({ type: 'object', properties, ...(required && { required }) });
const str = (extra: Json = {}) => ({ type: 'string', ...extra });
const nstr = (extra: Json = {}) => ({ type: 'string', nullable: true, ...extra });
const idParam = (name = 'id') => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const q = (name: string, description: string, schema: Json = { type: 'string' }) => ({ name, in: 'query', required: false, description, schema });
const reqBody = (schema: Json) => ({ required: true, content: json(schema) });
const ok = (description: string, schema?: Json) => ({ description, ...(schema && { content: json(schema) }) });

function op(tag: string, summary: string, o: { description?: string; params?: Json[]; body?: Json; res?: Json; status?: number; extra?: Json } = {}): Json {
  const status = o.status ?? 200;
  return {
    tags: [tag],
    summary,
    ...(o.description && { description: o.description }),
    ...(o.params && { parameters: o.params }),
    ...(o.body && { requestBody: reqBody(o.body) }),
    responses: {
      [status]: status === 204 ? { description: 'No content' } : ok('Success', o.res),
      400: { $ref: '#/components/responses/BadRequest' },
      ...errors,
      ...(o.extra ?? {}),
    },
  };
}

const assetBody = {
  name: str({ example: 'MacBook Pro 14' }),
  category: str({ example: 'Hardware', description: 'Existing category name (case-insensitive)' }),
  status: str({ enum: ['ACTIVE', 'MAINTENANCE', 'RETIRED', 'LOST'] }),
  assigneeId: nstr(),
  department: nstr({ example: 'Engineering', description: 'Existing department name' }),
  serialNumber: nstr(), manufacturer: nstr(), model: nstr(), specification: nstr(), vendor: nstr(),
  purchaseDate: nstr({ format: 'date' }), purchaseCost: { type: 'number', nullable: true },
  warrantyExpiry: nstr({ format: 'date' }),
  insuranceStatus: nstr({ enum: ['INSURED', 'UNINSURED', 'UNDER_REVIEW'] }),
  policyRef: nstr(), location: nstr(), notes: nstr(),
  usefulLifeYears: { type: 'integer', nullable: true },
};

export const v2Tags = [
  { name: 'Teams', description: 'Groups of users that can be assigned assets and credentials' },
  { name: 'Requests', description: 'Access requests and purchase requisitions' },
  { name: 'Categories & Departments', description: 'Lookup lists used by asset forms' },
  { name: 'Settings', description: 'Preferences, login history, two-factor authentication' },
  { name: 'API Keys', description: 'Programmatic access (Bearer kv_live_…)' },
  { name: 'Alert Rules', description: 'Threshold alerts over audit activity' },
  { name: 'Webhooks', description: 'Signed event delivery (HMAC SHA-256 in X-KickVault-Signature)' },
  { name: 'Integrations', description: 'Slack / Microsoft Teams incoming-webhook notifications' },
  { name: 'Reports', description: 'Organisation overview' },
];

export const v2Schemas: Json = {
  PermissionLevel: { type: 'string', enum: ['VIEW', 'COPY', 'EDIT', 'MANAGE'], description: 'VIEW = view only, COPY = may reveal/copy the secret, EDIT = may modify, MANAGE = edit + share' },
  CredentialType: { type: 'string', enum: ['LOGIN', 'API_KEY', 'SSH_KEY', 'SOFTWARE_LICENSE', 'TOKEN', 'CERTIFICATE', 'OTHER'] },
  AuditAction: { type: 'string', enum: ['CREATE', 'EDIT', 'DELETE', 'REVEAL', 'COPY', 'SHARE', 'REVOKE_SHARE', 'RESTORE', 'DISPOSAL', 'LOGIN', 'LOGOUT', 'APPROVE_REQUEST', 'DENY_REQUEST', 'CHECKIN', 'CHECKOUT'] },
  Asset: obj({
    id: str(), assetId: str({ example: 'HW-48291', description: 'Auto-generated from the category prefix unless supplied on create' }),
    ...assetBody,
    assignee: { type: 'object', nullable: true, properties: { id: str(), name: str(), email: str(), avatarUrl: nstr() } },
    warrantyState: nstr({ enum: ['VALID', 'EXPIRING', 'EXPIRED'] }),
    depreciationMethod: str({ example: 'STRAIGHT_LINE' }),
    recoveryRequestedAt: nstr({ format: 'date-time' }), disposedAt: nstr({ format: 'date-time' }), certificateRef: nstr(),
    createdById: str(), createdAt: str({ format: 'date-time' }), updatedAt: str({ format: 'date-time' }),
  }),
  Credential: obj({
    id: str(), friendlyName: str(), credType: ref('CredentialType'), systemHost: nstr(), username: nstr(), policyRef: nstr(),
    expiresAt: nstr({ format: 'date-time' }), currentVersion: { type: 'integer' },
    owner: obj({ id: str(), name: str() }), shareCount: { type: 'integer', description: 'Users/teams (other than the owner) with access' },
    myPermission: { ...ref('PermissionLevel'), nullable: true },
    createdAt: str({ format: 'date-time' }), updatedAt: str({ format: 'date-time' }),
  }),
  AuditEntry: obj({
    id: str(), action: ref('AuditAction'), targetType: str({ example: 'CREDENTIAL' }), targetId: nstr(), targetName: nstr(),
    userId: str(), user: obj({ id: str(), email: str(), name: str() }), ipAddress: nstr(), userAgent: nstr(), metadata: { nullable: true },
    createdAt: str({ format: 'date-time' }),
  }),
  UserListItem: obj({
    id: str(), email: str(), name: str(), role: ref('Role'), department: nstr(), avatarUrl: nstr(),
    status: str({ enum: ['ACTIVE', 'PENDING', 'DEACTIVATED'] }),
    teams: { type: 'array', items: obj({ id: str(), name: str() }) },
    lastLoginAt: nstr({ format: 'date-time' }), createdAt: str({ format: 'date-time' }),
  }),
  Team: obj({ id: str(), name: str(), description: nstr(), memberCount: { type: 'integer' }, assetCount: { type: 'integer' }, credentialCount: { type: 'integer' }, createdAt: str({ format: 'date-time' }) }),
  AccessRequest: obj({
    id: str(), type: str({ enum: ['ASSET_ACCESS', 'CREDENTIAL_ACCESS', 'PURCHASE'] }),
    status: str({ enum: ['PENDING', 'APPROVED', 'DENIED', 'CANCELLED'] }),
    requester: obj({ id: str(), name: str(), email: str() }), reason: nstr(), itemDescription: nstr(),
    purchaseCost: { type: 'number', nullable: true }, grantedPermission: { ...ref('PermissionLevel'), nullable: true },
    createdAt: str({ format: 'date-time' }),
  }),
  ImportResult: obj({
    total: { type: 'integer' }, valid: { type: 'integer' }, skipped: { type: 'integer' },
    rows: { type: 'array', items: obj({ line: { type: 'integer' }, valid: { type: 'boolean' }, errors: { type: 'array', items: str() } }) },
  }),
  Preferences: obj({
    notifications: obj({ transactionAlerts: { type: 'boolean' }, credentialRevealEvents: { type: 'boolean' }, expiryWarnings: { type: 'boolean' }, criticalEventsOnly: { type: 'boolean' }, emailDigest: { type: 'boolean' }, weeklyDigest: { type: 'boolean' }, slackWebhookUrl: nstr() }),
    appearance: obj({ theme: str({ enum: ['SYSTEM', 'LIGHT', 'DARK'] }), fontSize: str({ enum: ['SMALL', 'DEFAULT', 'LARGE'] }), sidebarDefault: str({ enum: ['EXPANDED', 'COLLAPSED'] }), secretMask: str({ enum: ['BULLETS', 'ASTERISKS', 'DASHES'] }), reduceMotion: { type: 'boolean' } }),
    security: obj({ loginNotifications: { type: 'boolean' }, requireReauthForReveals: { type: 'boolean' }, sessionTimeoutMinutes: { type: 'integer', nullable: true }, twoFactorEnabled: { type: 'boolean' } }),
  }),
};

const credBody = {
  friendlyName: str(), credType: ref('CredentialType'), systemHost: str(), username: str(),
  secret: str({ description: 'Encrypted at rest; never returned by list/get' }), policyRef: str(), expiresAt: str({ format: 'date-time' }),
};
const csvBody = obj({ csv: str({ description: 'Pasted CSV text (max 1 MB, 500 rows)' }) }, ['csv']);
const revealBody = obj({ password: str({ description: 'Required only when the user enabled “Require re-authentication for reveals”' }) });

export const v2Paths: Json = {
  // ── Assets ──
  '/assets': {
    post: op('Assets', 'Create an asset', { status: 201, body: obj({ assetId: str({ description: 'Optional custom ID' }), ...assetBody }, ['name', 'category']), res: obj({ asset: ref('Asset') }), extra: { 404: { $ref: '#/components/responses/NotFound' }, 409: { $ref: '#/components/responses/Conflict' } } }),
    get: op('Assets', 'List assets', {
      description: 'Filters accept comma-separated values. Pass `limit` to paginate.',
      params: [q('search', 'Name, asset ID, serial number, assignee or department'), q('category', 'Category names'), q('status', 'ACTIVE,MAINTENANCE,RETIRED,LOST,DISPOSED'), q('department', 'Department names'), q('assignee', 'Assignee user IDs'), q('insurance', 'INSURED,UNINSURED,UNDER_REVIEW'), q('sort', 'registered_desc|registered_asc|name_asc|name_desc|warranty_asc|warranty_desc'), q('page', 'Page (with limit)', { type: 'integer' }), q('limit', 'Page size', { type: 'integer' })],
      res: obj({ assets: { type: 'array', items: ref('Asset') }, total: { type: 'integer' } }),
    }),
  },
  '/assets/facets': { get: op('Assets', 'Filter counts', { description: 'Counts per category, status, department, assignee and insurance status for the filter dropdowns.' }) },
  '/assets/import/preview': { post: op('Assets', 'Validate and preview a CSV import', { description: 'Columns: assetId, name (required); category, status, assignee, department, purchaseCost, vendor.', body: csvBody, res: ref('ImportResult') }) },
  '/assets/import': { post: op('Assets', 'Import assets from CSV', { status: 201, body: csvBody, res: ref('ImportResult') }) },
  '/assets/{id}': {
    get: op('Assets', 'Get an asset', { params: [idParam()], res: obj({ asset: ref('Asset') }), extra: { 404: { $ref: '#/components/responses/NotFound' } } }),
    patch: op('Assets', 'Update an asset', { description: 'Asset ID is immutable. DISPOSED assets cannot be edited; use /dispose to retire an asset.', params: [idParam()], body: obj(assetBody), res: obj({ asset: ref('Asset') }), extra: { 409: { $ref: '#/components/responses/Conflict' } } }),
    delete: op('Assets', 'Delete an asset (soft)', { params: [idParam()], status: 204 }),
  },
  '/assets/{id}/financials': { get: op('Assets', 'Financials and amortization schedule', { description: 'Straight-line depreciation with no salvage value, one full year charged per calendar year from the purchase year.', params: [idParam()] }) },
  '/assets/{id}/checkouts': { get: op('Assets', 'Check-out history', { params: [idParam()] }) },
  '/assets/{id}/checkout': { post: op('Assets', 'Check out an asset', { description: 'Assigns the asset until `dueDate`. Access granted by the checkout is revoked automatically after the due date.', status: 201, params: [idParam()], body: obj({ assigneeId: str(), dueDate: str({ format: 'date' }) }, ['assigneeId', 'dueDate']) }) },
  '/assets/{id}/checkin': { post: op('Assets', 'Check in an asset', { params: [idParam()] }) },
  '/assets/{id}/service-history': {
    get: op('Assets', 'List service records', { params: [idParam()] }),
    post: op('Assets', 'Add a service record', { status: 201, params: [idParam()], body: obj({ serviceDate: str({ format: 'date' }), technician: str(), description: str(), cost: { type: 'number' } }, ['serviceDate', 'technician', 'description', 'cost']) }),
  },
  '/assets/{id}/service-history/{recordId}': { delete: op('Assets', 'Delete a service record', { status: 204, params: [idParam(), idParam('recordId')] }) },
  '/assets/{id}/attachments': {
    get: op('Assets', 'List attachments', { params: [idParam()] }),
    post: { tags: ['Assets'], summary: 'Upload an attachment', description: 'multipart/form-data, field `file` (PDF, image, Office document, text/CSV; max 15 MB). Stored privately.', parameters: [idParam()], requestBody: { required: true, content: { 'multipart/form-data': { schema: obj({ file: { type: 'string', format: 'binary' } }) } } }, responses: { 201: ok('Created'), ...errors } },
  },
  '/assets/{id}/attachments/{attachmentId}/download': { get: op('Assets', 'Get a short-lived signed download URL', { params: [idParam(), idParam('attachmentId')] }) },
  '/assets/{id}/attachments/{attachmentId}': { delete: op('Assets', 'Delete an attachment', { status: 204, params: [idParam(), idParam('attachmentId')] }) },
  '/assets/{id}/dispose': {
    post: op('Assets', 'Retire & dispose', {
      description: 'Irreversible. Sets status DISPOSED, issues a certificate of destruction and records a DISPOSAL audit entry.',
      status: 201, params: [idParam()],
      body: obj({ wipedBy: str(), wipeMethod: str({ enum: ['NIST_SP_800_88', 'DOD_5220_22_M', 'PHYSICAL_DESTRUCTION', 'FACTORY_RESET', 'DEGAUSSING'] }), disposalDate: str({ format: 'date' }), notes: str(), confirmed: { type: 'boolean', enum: [true] } }, ['wipedBy', 'wipeMethod', 'confirmed']),
    }),
  },
  '/assets/{id}/certificate': { get: op('Assets', 'Certificate of destruction', { params: [idParam(), q('format', '`pdf` to download a PDF')] }) },
  '/assets/{id}/label': { get: op('Assets', 'Barcode (QR) label', { params: [idParam(), q('format', '`pdf` to download a printable label')] }) },
  '/assets/{assetId}/access': {
    get: op('Asset Access', 'Sharing view: owner, grants and team grants', { description: 'Requires MANAGE on the asset.', params: [idParam('assetId')] }),
    post: op('Asset Access', 'Grant or change access (audited as SHARE)', { description: 'Requires MANAGE on the asset.', status: 201, params: [idParam('assetId')], body: obj({ userId: str(), permission: ref('PermissionLevel') }, ['userId']) }),
  },
  '/assets/{assetId}/access/{userId}': { delete: op('Asset Access', 'Revoke access (audited as REVOKE_SHARE)', { status: 204, params: [idParam('assetId'), idParam('userId')] }) },

  // ── Credentials ──
  '/credentials': {
    post: op('Credentials', 'Store a credential', { status: 201, body: obj(credBody, ['friendlyName', 'secret']), res: obj({ credential: ref('Credential') }) }),
    get: op('Credentials', 'List credentials', { description: 'Secrets are never returned.', params: [q('search', 'Name, system or username'), q('credType', 'Comma-separated credential types'), q('expiring_within', 'e.g. 30d')], res: obj({ credentials: { type: 'array', items: ref('Credential') } }) }),
  },
  '/credentials/facets': { get: op('Credentials', 'Counts per credential type') },
  '/credentials/generate-secret': { post: op('Credentials', 'Generate a random secret', { body: obj({ length: { type: 'integer', default: 20 }, symbols: { type: 'boolean', default: true } }), res: obj({ secret: str() }) }) },
  '/credentials/import/preview': { post: op('Credentials', 'Validate and preview a CSV import', { description: 'Columns: friendlyName, secret (required); system, username, credType. Secrets are never echoed.', body: csvBody, res: ref('ImportResult') }) },
  '/credentials/import': { post: op('Credentials', 'Import credentials from CSV', { status: 201, body: csvBody, res: ref('ImportResult') }) },
  '/credentials/{id}': {
    get: op('Credentials', 'Get a credential', { params: [idParam()], res: obj({ credential: ref('Credential') }) }),
    patch: op('Credentials', 'Update a credential', { description: 'Changing `secret` creates a new version.', params: [idParam()], body: obj(credBody), res: obj({ credential: ref('Credential') }) }),
    delete: op('Credentials', 'Decommission a credential', { description: 'Irrecoverably destroys the secret and every previous version.', params: [idParam()], status: 204 }),
  },
  '/credentials/{id}/reveal': { post: op('Credentials', 'Reveal the secret (audited REVEAL)', { description: 'Requires COPY permission or higher. Rate limited.', params: [idParam()], body: revealBody, res: obj({ secret: str() }) }) },
  '/credentials/{id}/copy': { post: op('Credentials', 'Copy the secret (audited COPY)', { params: [idParam()], body: revealBody, res: obj({ secret: str() }) }) },
  '/credentials/{id}/versions': { get: op('Credentials', 'Version history', { description: 'Requires EDIT.', params: [idParam()] }) },
  '/credentials/{id}/versions/{versionId}/restore': { post: op('Credentials', 'Restore a previous version (audited RESTORE)', { params: [idParam(), idParam('versionId')] }) },
  '/credentials/{id}/versions/{versionId}/reveal': { post: op('Credentials', 'Reveal a previous version’s secret', { params: [idParam(), idParam('versionId')], body: revealBody }) },
  '/credentials/{credentialId}/access': {
    get: op('Credential Access', 'Sharing view: owner, grants and team grants', { description: 'Requires MANAGE on the credential.', params: [idParam('credentialId')] }),
    post: op('Credential Access', 'Grant or change access (audited as SHARE)', { description: 'Requires MANAGE on the credential.', status: 201, params: [idParam('credentialId')], body: obj({ userId: str(), permission: ref('PermissionLevel') }, ['userId']) }),
  },
  '/credentials/{credentialId}/access/{userId}': { delete: op('Credential Access', 'Revoke access (audited as REVOKE_SHARE)', { status: 204, params: [idParam('credentialId'), idParam('userId')] }) },

  // ── Audit logs ──
  '/audit-logs': { get: op('Audit Logs', 'List audit logs', { description: 'MANAGER+. Cursor pagination.', params: [q('action', 'Comma-separated actions'), q('entityType', 'Comma-separated entity types'), q('userId', 'User ID'), q('search', 'User, action, entity or target ID'), q('startDate', 'ISO datetime'), q('endDate', 'ISO datetime'), q('cursor', 'Cursor'), q('limit', 'Page size', { type: 'integer' })], res: obj({ items: { type: 'array', items: ref('AuditEntry') }, nextCursor: str(), hasMore: { type: 'boolean' } }) }) },
  '/audit-logs/facets': { get: op('Audit Logs', 'Counts per action', { description: 'All 15 actions are listed, including those with a count of 0.' }) },
  '/audit-logs/export': { get: op('Audit Logs', 'Export (SUPER_ADMIN)', { params: [q('format', 'csv (default) or pdf'), q('action', 'Comma-separated actions'), q('search', 'Free text'), q('startDate', 'ISO datetime'), q('endDate', 'ISO datetime')] }) },
  '/audit-logs/{id}': { get: op('Audit Logs', 'Audit entry detail', { description: 'Includes a human-readable description.', params: [idParam()] }) },

  // ── Users ──
  '/users': { get: op('Users', 'List users', { description: 'MANAGER+.', params: [q('search', 'Name or email'), q('role', 'Comma-separated roles'), q('status', 'ACTIVE,PENDING,DEACTIVATED'), q('department', 'Department'), q('page', 'Page', { type: 'integer' }), q('limit', 'Page size', { type: 'integer' })], res: obj({ users: { type: 'array', items: ref('UserListItem') }, total: { type: 'integer' } }) }) },
  '/users/stats': { get: op('Users', 'Header counts: total, active, pending, deactivated and role counts', { description: 'MANAGER+.' }) },
  '/users/lookup': { get: op('Users', 'Directory search for user pickers', { description: 'Any signed-in user. Returns id, name, email, role, avatar of active users.', params: [q('search', 'Name or email'), q('limit', 'Max results', { type: 'integer' })] }) },
  '/users/invite': { post: op('Users', 'Invite a user', { status: 201, body: obj({ email: str({ format: 'email' }), name: str(), role: ref('Role'), department: str() }, ['email', 'name', 'role']) }) },
  '/users/{id}': {
    get: op('Users', 'User details', { description: 'Profile, teams, assigned assets and shared credentials. MANAGER+.', params: [idParam()] }),
    patch: op('Users', 'Edit a user (SUPER_ADMIN)', { params: [idParam()], body: obj({ name: str(), email: str({ format: 'email' }), role: ref('Role'), department: nstr() }) }),
    delete: op('Users', 'Permanently delete a user (SUPER_ADMIN)', { status: 204, params: [idParam()] }),
  },
  '/users/{id}/deactivate': { post: op('Users', 'Deactivate a user', { description: 'Ends all sessions, flags assigned assets for recovery and emails administrators. Returns `flaggedAssets`.', params: [idParam()] }) },
  '/users/{id}/reactivate': { post: op('Users', 'Reactivate a deactivated user', { params: [idParam()] }) },
  '/users/me': { delete: op('Settings', 'Delete my account', { description: 'Permanent. Requires password confirmation.', status: 204, body: obj({ password: str() }, ['password']) }) },
  '/users/me/preferences': {
    get: op('Settings', 'Get notification, appearance and security preferences', { res: obj({ preferences: ref('Preferences') }) }),
    patch: op('Settings', 'Update preferences (partial)', { body: ref('Preferences'), res: obj({ preferences: ref('Preferences') }) }),
  },
  '/users/me/login-history': { get: op('Settings', 'Recent login history', { description: 'Failed attempts and sign-ins from a new IP are flagged `THREAT`.' }) },
  '/users/me/2fa/setup': { post: op('Settings', 'Begin TOTP setup', { status: 201, description: 'Returns the secret and otpauth URL. 2FA stays off until /enable succeeds.' }) },
  '/users/me/2fa/enable': { post: op('Settings', 'Confirm TOTP setup with a code', { body: obj({ code: str({ example: '123456' }) }, ['code']) }) },
  '/users/me/2fa/disable': { post: op('Settings', 'Disable TOTP', { body: obj({ password: str() }, ['password']) }) },
  '/auth/login': {
    post: {
      tags: ['Auth'], summary: 'Log in', security: [],
      requestBody: reqBody(obj({ email: str({ format: 'email' }), password: str(), totpCode: str({ description: '6-digit code, required when 2FA is enabled' }) }, ['email', 'password'])),
      responses: { 200: ok('Tokens'), 401: { description: 'Invalid credentials, or `error.code = TOTP_REQUIRED` when a 2FA code must be supplied' }, 403: { description: 'Account locked' } },
    },
  },

  // ── Teams ──
  '/teams': {
    get: op('Teams', 'List teams', { description: 'MANAGER+.', params: [q('search', 'Name or description')], res: obj({ teams: { type: 'array', items: ref('Team') } }) }),
    post: op('Teams', 'Create a team', { status: 201, body: obj({ name: str(), description: str(), memberIds: { type: 'array', items: str() } }, ['name']) }),
  },
  '/teams/{id}': {
    get: op('Teams', 'Team details: members, assets, credentials', { params: [idParam()] }),
    patch: op('Teams', 'Edit a team (memberIds replaces the member list)', { params: [idParam()], body: obj({ name: str(), description: nstr(), memberIds: { type: 'array', items: str() } }) }),
    delete: op('Teams', 'Delete a team', { status: 204, params: [idParam()] }),
  },
  '/teams/{id}/assets': { post: op('Teams', 'Assign an asset to a team', { status: 201, params: [idParam()], body: obj({ assetId: str(), permission: ref('PermissionLevel') }, ['assetId']) }) },
  '/teams/{id}/assets/{assetId}': { delete: op('Teams', 'Unassign an asset', { status: 204, params: [idParam(), idParam('assetId')] }) },
  '/teams/{id}/credentials': { post: op('Teams', 'Share a credential with a team', { status: 201, params: [idParam()], body: obj({ credentialId: str(), permission: ref('PermissionLevel') }, ['credentialId']) }) },
  '/teams/{id}/credentials/{credentialId}': { delete: op('Teams', 'Remove a credential from a team', { status: 204, params: [idParam(), idParam('credentialId')] }) },

  // ── Requests ──
  '/requests': {
    post: op('Requests', 'Submit a request', {
      description: 'Discriminated by `type`: ASSET_ACCESS {assetId, reason ≤200}, CREDENTIAL_ACCESS {credentialId, reason ≤200}, PURCHASE {itemDescription, category, purchaseCost?, justification?}.',
      status: 201, body: obj({ type: str({ enum: ['ASSET_ACCESS', 'CREDENTIAL_ACCESS', 'PURCHASE'] }) }, ['type']), res: obj({ request: ref('AccessRequest') }),
    }),
    get: op('Requests', 'List requests', { description: 'Managers see all; everyone else sees their own.', params: [q('status', 'Comma-separated'), q('type', 'Comma-separated'), q('search', 'Free text'), q('page', 'Page', { type: 'integer' }), q('limit', 'Page size', { type: 'integer' })] }),
  },
  '/requests/pending-count': { get: op('Requests', 'Pending count (sidebar badge)') },
  '/requests/{id}': { get: op('Requests', 'Get a request', { params: [idParam()] }) },
  '/requests/{id}/approve': { post: op('Requests', 'Approve (MANAGER+, audited APPROVE_REQUEST)', { description: 'For access requests, grants `permission` (default VIEW).', params: [idParam()], body: obj({ permission: ref('PermissionLevel'), note: str() }) }) },
  '/requests/{id}/deny': { post: op('Requests', 'Deny (MANAGER+, audited DENY_REQUEST)', { params: [idParam()], body: obj({ note: str() }) }) },
  '/requests/{id}/cancel': { post: op('Requests', 'Cancel my pending request', { params: [idParam()] }) },

  // ── Lookups ──
  '/categories': { get: op('Categories & Departments', 'List categories with asset counts'), post: op('Categories & Departments', 'Create a category', { status: 201, body: obj({ name: str() }, ['name']) }) },
  '/departments': { get: op('Categories & Departments', 'List departments with asset counts'), post: op('Categories & Departments', 'Create a department', { status: 201, body: obj({ name: str() }, ['name']) }) },

  // ── API keys ──
  '/api-keys': {
    get: op('API Keys', 'List my API keys'),
    post: op('API Keys', 'Generate an API key', { description: 'The plaintext key is returned once. READ_ONLY keys may call GET endpoints plus credential reveal.', status: 201, body: obj({ name: str(), scope: str({ enum: ['READ_ONLY', 'READ_WRITE'] }) }, ['name']) }),
  },
  '/api-keys/{id}': { delete: op('API Keys', 'Revoke an API key', { status: 204, params: [idParam()] }) },

  // ── Alert rules ──
  '/alert-rules': {
    get: op('Alert Rules', 'List alert rules (MANAGER+)'),
    post: op('Alert Rules', 'Create a rule (SUPER_ADMIN)', { status: 201, description: 'Fires when one user performs `actionType` `threshold` times within `windowMinutes`.', body: obj({ name: str(), actionType: ref('AuditAction'), threshold: { type: 'integer' }, windowMinutes: { type: 'integer' }, enabled: { type: 'boolean' } }, ['name', 'actionType', 'threshold', 'windowMinutes']) }),
  },
  '/alert-rules/events': { get: op('Alert Rules', 'Recently triggered alerts (MANAGER+)') },
  '/alert-rules/{id}': {
    patch: op('Alert Rules', 'Update / enable / disable a rule (SUPER_ADMIN)', { params: [idParam()] }),
    delete: op('Alert Rules', 'Delete a rule (SUPER_ADMIN)', { status: 204, params: [idParam()] }),
  },

  // ── Webhooks / integrations ──
  '/webhooks': {
    get: op('Webhooks', 'List webhooks (SUPER_ADMIN)'),
    post: op('Webhooks', 'Add a webhook (SUPER_ADMIN)', { status: 201, description: 'HTTPS only. The signing secret is returned once.', body: obj({ url: str({ format: 'uri' }), events: { type: 'array', items: str({ example: 'credential.created' }) } }, ['url', 'events']) }),
  },
  '/webhooks/events': { get: op('Webhooks', 'Subscribable event names') },
  '/webhooks/{id}': {
    patch: op('Webhooks', 'Update / pause a webhook', { params: [idParam()] }),
    delete: op('Webhooks', 'Delete a webhook', { status: 204, params: [idParam()] }),
  },
  '/integrations': { get: op('Integrations', 'Slack / Teams connection status (SUPER_ADMIN)') },
  '/integrations/{provider}': {
    put: op('Integrations', 'Connect Slack or Teams with an incoming-webhook URL', { params: [{ name: 'provider', in: 'path', required: true, schema: { type: 'string', enum: ['slack', 'teams'] } }], body: obj({ webhookUrl: str({ format: 'uri' }) }, ['webhookUrl']) }),
    delete: op('Integrations', 'Disconnect', { status: 204, params: [{ name: 'provider', in: 'path', required: true, schema: { type: 'string', enum: ['slack', 'teams'] } }] }),
  },

  // ── Reports ──
  '/reports/overview': { get: op('Reports', 'Organisation overview (MANAGER+)', { description: 'Asset mix and financial position, credential hygiene, request backlog and 30-day audit activity.' }) },
};
