/**
 * The audit actions shown in the Locker Room "All Actions" filter.
 * Legacy rows written before the v2 design use 'UPDATE' for what is now 'EDIT'.
 */
export const AUDIT_ACTIONS = [
  'CREATE',
  'EDIT',
  'DELETE',
  'REVEAL',
  'COPY',
  'SHARE',
  'REVOKE_SHARE',
  'RESTORE',
  'DISPOSAL',
  'LOGIN',
  'LOGOUT',
  'APPROVE_REQUEST',
  'DENY_REQUEST',
  'CHECKIN',
  'CHECKOUT',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const ACTION_DESCRIPTIONS: Record<AuditAction, string> = {
  CREATE: 'A new entity was registered on the platform.',
  EDIT: 'An existing entity was modified.',
  DELETE: 'An entity was removed or decommissioned.',
  REVEAL: 'A stored secret was revealed in plain text.',
  COPY: 'A stored secret was copied to the clipboard.',
  SHARE: 'Access to an entity was granted to a user or team.',
  REVOKE_SHARE: 'Access to an entity was revoked.',
  RESTORE: 'A previous version of an entity was restored.',
  DISPOSAL: 'An asset was retired and a certificate of destruction was issued.',
  LOGIN: 'A user signed in.',
  LOGOUT: 'A user signed out.',
  APPROVE_REQUEST: 'An access or purchase request was approved.',
  DENY_REQUEST: 'An access or purchase request was denied.',
  CHECKIN: 'An asset was checked in.',
  CHECKOUT: 'An asset was checked out to a user.',
};

/** Map a stored action to its display name ('UPDATE' is the legacy spelling of 'EDIT'). */
export function normalizeAction(action: string): string {
  return action === 'UPDATE' ? 'EDIT' : action;
}

export function describeAction(action: string): string {
  const normalized = normalizeAction(action) as AuditAction;
  return ACTION_DESCRIPTIONS[normalized] ?? 'A system event was recorded.';
}

/** Expand display actions into the values that may be stored (EDIT also matches legacy UPDATE). */
export function storedActionValues(actions: string[]): string[] {
  const out = new Set<string>();
  for (const a of actions) {
    out.add(a);
    if (a === 'EDIT') out.add('UPDATE');
  }
  return [...out];
}
