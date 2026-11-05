import { PermissionLevel } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { encrypt } from '../../lib/crypto.js';
import { parseCsvTable } from '../../lib/csv.js';
import { ValidationError } from '../../lib/errors.js';
import type { AuditParams } from '../../services/audit.service.js';
import { normalizeCredType, type CredentialTypeValue } from './credentials.validation.js';

type Ctx = Pick<AuditParams, 'ipAddress' | 'userAgent'>;
const MAX_ROWS = 500;

export interface CredentialImportRow {
  line: number;
  valid: boolean;
  errors: string[];
  friendlyName: string;
  system: string | null;
  username: string | null;
  credType: CredentialTypeValue;
}

interface Parsed extends CredentialImportRow {
  secret: string;
}

/** Required columns: friendlyName, secret. Optional: system, username, credType. */
function parseRows(csv: string): Parsed[] {
  const table = parseCsvTable(csv);
  const keys = table.headers.map((h) => h.toLowerCase());
  for (const required of ['friendlyname', 'secret']) {
    if (!keys.includes(required)) {
      throw new ValidationError(`CSV is missing required column "${required === 'friendlyname' ? 'friendlyName' : 'secret'}"`);
    }
  }
  if (table.records.length === 0) throw new ValidationError('CSV contains no data rows');
  if (table.records.length > MAX_ROWS) throw new ValidationError(`CSV exceeds the ${MAX_ROWS} row limit`);

  return table.records.map(({ line, values }) => {
    const errors: string[] = [];
    const friendlyName = values['friendlyname'] ?? '';
    const secret = values['secret'] ?? '';
    const typeRaw = values['credtype'] ?? '';
    if (!friendlyName) errors.push('friendlyName is required');
    if (friendlyName.length > 255) errors.push('friendlyName is too long');
    if (!secret) errors.push('secret is required');
    let credType: CredentialTypeValue = 'OTHER';
    if (typeRaw) {
      const parsed = normalizeCredType(typeRaw);
      if (parsed) credType = parsed;
      else errors.push(`credType "${typeRaw}" is not recognised`);
    }
    return {
      line,
      valid: errors.length === 0,
      errors,
      friendlyName,
      system: values['system'] || values['systemhost'] || null,
      username: values['username'] || null,
      credType,
      secret,
    };
  });
}

// Secrets are never echoed back in previews or results.
const publicRow = ({ secret: _s, ...row }: Parsed): CredentialImportRow => row;

export function previewCredentialImport(csv: string) {
  const rows = parseRows(csv);
  const valid = rows.filter((r) => r.valid).length;
  return { total: rows.length, valid, skipped: rows.length - valid, rows: rows.map(publicRow) };
}

export async function importCredentials(csv: string, userId: string, ctx: Ctx = {}) {
  const rows = parseRows(csv);
  let imported = 0;
  for (const r of rows.filter((x) => x.valid)) {
    const enc = encrypt(r.secret);
    await prisma.$transaction(async (tx) => {
      const cred = await tx.credential.create({
        data: {
          friendlyName: r.friendlyName,
          credType: r.credType,
          systemHost: r.system,
          username: r.username,
          encryptedValue: enc.encryptedValue,
          iv: enc.iv,
          authTag: enc.authTag,
          keyVersion: enc.keyVersion,
          createdById: userId,
          versions: { create: { version: 1, ...enc, createdById: userId } },
        },
        select: { id: true },
      });
      await tx.credentialAccess.create({ data: { userId, credentialId: cred.id, permission: PermissionLevel.MANAGE } });
      await tx.auditLog.create({
        data: { userId, action: 'CREATE', targetType: 'CREDENTIAL', targetId: cred.id, metadata: { via: 'csv-import' }, ipAddress: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null },
      });
    });
    imported++;
  }
  return { imported, skipped: rows.length - imported, rows: rows.map(publicRow) };
}
