import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { prisma, basePrisma } from '../config/database.js';
import { hashPassword } from '../services/password.service.js';
import { signAccessToken } from '../services/token.service.js';
import { setFetch } from '../services/email.service.js';
import { setEventFetch } from '../services/events.service.js';
import { expireOverdueCheckouts } from './assets/assets.lifecycle.service.js';
import { totpCode } from '../lib/totp.js';
import type { Role } from '@prisma/client';

const canConnect = await prisma
  .$connect()
  .then(() => true)
  .catch(() => false);
const describeWithDb = canConnect ? describe : describe.skip;

const PASSWORD = 'SuperSecure123!';
let passwordHash: string;
let n = 0;

beforeAll(async () => {
  if (!canConnect) return;
  passwordHash = await hashPassword(PASSWORD);
  // Never touch the network from tests.
  setFetch(vi.fn().mockResolvedValue({ ok: true, json: async () => ({}), text: async () => '' }) as unknown as typeof fetch);
});

async function wipe() {
  await basePrisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs" CASCADE');
  await prisma.accessRequest.deleteMany();
  await prisma.alertEvent.deleteMany();
  await prisma.alertRule.deleteMany();
  await prisma.webhook.deleteMany();
  await prisma.integration.deleteMany();
  await prisma.team.deleteMany();
  await prisma.credentialVersion.deleteMany();
  await prisma.credentialAccess.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.assetAccess.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.session.deleteMany();
  await prisma.userPreference.deleteMany();
  await prisma.loginEvent.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
  await prisma.category.deleteMany({ where: { id: { not: { startsWith: 'cat_' } } } });
}

beforeEach(async () => {
  if (canConnect) await wipe();
});
afterAll(async () => {
  if (!canConnect) return;
  await wipe();
  await prisma.$disconnect();
});

// ─── helpers ────────────────────────────────────────────────────────────────

async function user(role: Role = 'MEMBER', extra: Partial<{ name: string; email: string; isActive: boolean }> = {}) {
  n++;
  return prisma.user.create({
    data: { email: extra.email ?? `lr${n}@test.com`, name: extra.name ?? `LR User ${n}`, passwordHash, role, isActive: extra.isActive ?? true },
  });
}
const tokenFor = (u: { id: string; role: Role }) => signAccessToken({ userId: u.id, role: u.role, sessionId: `s-${u.id}` });
const as = async (u: { id: string; role: Role }) => ({ Authorization: `Bearer ${await tokenFor(u)}` });

async function asset(admin: { id: string; role: Role }, body: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/assets').set(await as(admin)).send({ name: 'MacBook Pro 14', category: 'Hardware', ...body });
  expect(res.status).toBe(201);
  return res.body.asset as { id: string; assetId: string; [k: string]: any };
}
async function credential(admin: { id: string; role: Role }, body: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/credentials').set(await as(admin)).send({ friendlyName: 'Prod DB Admin', secret: 'first-secret', ...body });
  expect(res.status).toBe(201);
  return res.body.credential as { id: string; [k: string]: any };
}

// ─── Assets ─────────────────────────────────────────────────────────────────

describeWithDb('Assets (v2 design)', () => {
  it('creates an asset with the full detail set and exposes it on list + detail', async () => {
    const admin = await user('SUPER_ADMIN');
    const bob = await user('MEMBER', { name: 'Bob Builder' });
    await request(app).post('/api/departments').set(await as(admin)).send({ name: 'Engineering' }).expect(201);

    const a = await asset(admin, {
      assetId: 'hw-001', department: 'engineering', assigneeId: bob.id, status: 'ACTIVE',
      serialNumber: 'C02G4190MD6R', manufacturer: 'Apple', model: 'MacBook Pro 14 M3 Pro', vendor: 'Apple UK',
      purchaseDate: '2022-10-02', purchaseCost: 2_400_000, usefulLifeYears: 5, warrantyExpiry: '2099-01-01',
      insuranceStatus: 'INSURED', policyRef: 'ALLIANZ-771',
    });
    expect(a).toMatchObject({ assetId: 'HW-001', category: 'Hardware', department: 'Engineering', purchaseCost: 2_400_000, warrantyState: 'VALID', insuranceStatus: 'INSURED' });
    expect(a.assignee).toMatchObject({ id: bob.id, name: 'Bob Builder' });

    // The assignee can see the asset even though they did not create it.
    const mine = await request(app).get('/api/assets').set(await as(bob)).expect(200);
    expect(mine.body.assets.map((x: any) => x.assetId)).toEqual(['HW-001']);

    const detail = await request(app).get(`/api/assets/${a.id}`).set(await as(bob)).expect(200);
    expect(detail.body.asset.serialNumber).toBe('C02G4190MD6R');
  });

  it('auto-generates an ID from the category prefix and rejects duplicates / unknown lookups', async () => {
    const admin = await user('SUPER_ADMIN');
    const auto = await asset(admin, { category: 'Software' });
    expect(auto.assetId).toMatch(/^SW-\d{5}$/);

    await asset(admin, { assetId: 'DUP-1' });
    const dup = await request(app).post('/api/assets').set(await as(admin)).send({ assetId: 'DUP-1', name: 'x', category: 'Hardware' });
    expect(dup.status).toBe(409);

    const badCat = await request(app).post('/api/assets').set(await as(admin)).send({ name: 'x', category: 'Furniture' });
    expect(badCat.status).toBe(400);
    const badDept = await request(app).post('/api/assets').set(await as(admin)).send({ name: 'x', category: 'Hardware', department: 'Nope' });
    expect(badDept.status).toBe(400);
  });

  it('creates new categories on demand and uses their prefix', async () => {
    const admin = await user('SUPER_ADMIN');
    await request(app).post('/api/categories').set(await as(admin)).send({ name: 'Peripheral' }).expect(201);
    const a = await asset(admin, { category: 'peripheral' });
    expect(a.assetId).toMatch(/^PE-\d{5}$/);
    await request(app).post('/api/categories').set(await as(admin)).send({ name: 'PERIPHERAL' }).expect(409);
  });

  it('filters by category/status/department/assignee/insurance, searches, sorts and returns facet counts', async () => {
    const admin = await user('SUPER_ADMIN');
    const bob = await user('MEMBER', { name: 'Bob Builder' });
    await prisma.department.createMany({ data: [{ name: 'Design' }, { name: 'Network' }] });
    await asset(admin, { assetId: 'A-1', name: 'Alpha', department: 'Design', assigneeId: bob.id, insuranceStatus: 'INSURED' });
    await asset(admin, { assetId: 'A-2', name: 'Beta', category: 'Software', department: 'Network', status: 'MAINTENANCE' });
    await asset(admin, { assetId: 'A-3', name: 'Gamma', category: 'Software', department: 'Network' });
    const h = await as(admin);

    const ids = async (qs: string) => ((await request(app).get(`/api/assets?${qs}`).set(h).expect(200)).body.assets as any[]).map((a) => a.assetId).sort();
    expect(await ids('category=software')).toEqual(['A-2', 'A-3']);
    expect(await ids('status=MAINTENANCE')).toEqual(['A-2']);
    expect(await ids('department=Network,Design')).toEqual(['A-1', 'A-2', 'A-3']);
    expect(await ids(`assignee=${bob.id}`)).toEqual(['A-1']);
    expect(await ids('insurance=INSURED')).toEqual(['A-1']);
    expect(await ids('search=bob')).toEqual(['A-1']);
    expect(await ids('search=gam')).toEqual(['A-3']);

    const sorted = await request(app).get('/api/assets?sort=name_desc').set(h).expect(200);
    expect(sorted.body.assets.map((a: any) => a.name)).toEqual(['Gamma', 'Beta', 'Alpha']);
    const paged = await request(app).get('/api/assets?limit=2&page=2').set(h).expect(200);
    expect(paged.body).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(paged.body.assets).toHaveLength(1);

    const facets = (await request(app).get('/api/assets/facets').set(h).expect(200)).body;
    expect(facets.categories.find((c: any) => c.name === 'Software').count).toBe(2);
    expect(facets.statuses.find((s: any) => s.value === 'MAINTENANCE').count).toBe(1);
    expect(facets.statuses.find((s: any) => s.value === 'DISPOSED').count).toBe(0);
    expect(facets.departments.find((d: any) => d.name === 'Network').count).toBe(2);
  });

  it('returns the depreciation schedule', async () => {
    const admin = await user('SUPER_ADMIN');
    const a = await asset(admin, { purchaseDate: '2022-10-02', purchaseCost: 2_400_000, usefulLifeYears: 5 });
    const res = await request(app).get(`/api/assets/${a.id}/financials`).set(await as(admin)).expect(200);
    expect(res.body.financials.annualDepreciation).toBe(480_000);
    expect(res.body.financials.schedule[0]).toMatchObject({ year: 2022, openingValue: 2_400_000, closingValue: 1_920_000 });
  });

  it('checks out, blocks double checkout, then checks in and removes the granted access', async () => {
    const admin = await user('SUPER_ADMIN');
    const bob = await user('MEMBER');
    const a = await asset(admin);
    const h = await as(admin);
    const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    const co = await request(app).post(`/api/assets/${a.id}/checkout`).set(h).send({ assigneeId: bob.id, dueDate: due });
    expect(co.status).toBe(201);
    expect(co.body.checkout).toMatchObject({ status: 'ACTIVE', dueDate: due });
    expect((await request(app).get(`/api/assets/${a.id}`).set(await as(bob))).status).toBe(200);
    expect((await request(app).post(`/api/assets/${a.id}/checkout`).set(h).send({ assigneeId: bob.id, dueDate: due })).status).toBe(409);
    expect((await request(app).post(`/api/assets/${a.id}/checkout`).set(h).send({ assigneeId: bob.id, dueDate: '2001-01-01' })).status).toBe(409);

    await request(app).post(`/api/assets/${a.id}/checkin`).set(h).expect(200);
    expect((await request(app).get(`/api/assets/${a.id}`).set(await as(bob))).status).toBe(403);
    const history = await request(app).get(`/api/assets/${a.id}/checkouts`).set(h).expect(200);
    expect(history.body.checkouts[0]).toMatchObject({ status: 'RETURNED' });

    const actions = (await prisma.auditLog.findMany({ where: { targetId: a.id } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['CHECKOUT', 'CHECKIN']));
  });

  it('automatically closes overdue checkouts and revokes the access they granted', async () => {
    const admin = await user('SUPER_ADMIN');
    const bob = await user('MEMBER');
    const a = await asset(admin);
    await prisma.assetAccess.create({ data: { assetId: a.id, userId: bob.id, permission: 'VIEW' } });
    await prisma.asset.update({ where: { id: a.id }, data: { assigneeId: bob.id } });
    await prisma.assetCheckout.create({
      data: { assetId: a.id, assigneeId: bob.id, checkedOutById: admin.id, dueDate: new Date('2020-01-01'), accessGranted: true },
    });

    expect(await expireOverdueCheckouts()).toBe(1);
    expect(await expireOverdueCheckouts()).toBe(0);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: a.id } })).assigneeId).toBeNull();
    expect(await prisma.assetAccess.count({ where: { assetId: a.id, userId: bob.id } })).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { targetId: a.id, action: 'CHECKIN' } });
    expect(log.metadata).toMatchObject({ auto: true });
  });

  it('records and lists service history', async () => {
    const admin = await user('SUPER_ADMIN');
    const a = await asset(admin);
    const h = await as(admin);
    const add = await request(app).post(`/api/assets/${a.id}/service-history`).set(h).send({ serviceDate: '2022-02-14', technician: 'Smart Hands', description: 'Thermal paste replacement', cost: 20000 });
    expect(add.status).toBe(201);
    expect((await request(app).post(`/api/assets/${a.id}/service-history`).set(h).send({ serviceDate: '2022-02-14', technician: 'x', description: 'y', cost: -1 })).status).toBe(400);
    const list = await request(app).get(`/api/assets/${a.id}/service-history`).set(h).expect(200);
    expect(list.body.serviceRecords).toEqual([expect.objectContaining({ technician: 'Smart Hands', cost: 20000, serviceDate: '2022-02-14' })]);
    await request(app).delete(`/api/assets/${a.id}/service-history/${add.body.serviceRecord.id}`).set(h).expect(204);
  });

  it('retires & disposes an asset: requires confirmation, issues a certificate, then locks the asset', async () => {
    const admin = await user('SUPER_ADMIN');
    const a = await asset(admin, { serialNumber: 'SER-1' });
    const h = await as(admin);
    const body = { wipedBy: 'Toheeb Ngozi Bashir', wipeMethod: 'FACTORY_RESET', disposalDate: '2026-10-02' };

    expect((await request(app).post(`/api/assets/${a.id}/dispose`).set(h).send(body)).status).toBe(400);
    expect((await request(app).post(`/api/assets/${a.id}/dispose`).set(h).send({ ...body, confirmed: false })).status).toBe(400);
    expect((await request(app).get(`/api/assets/${a.id}/certificate`).set(h)).status).toBe(404);

    const res = await request(app).post(`/api/assets/${a.id}/dispose`).set(h).send({ ...body, confirmed: true });
    expect(res.status).toBe(201);
    expect(res.body.certificate).toMatchObject({ assetId: a.assetId, method: 'Factory Reset', wipedBy: 'Toheeb Ngozi Bashir', sanitizationDate: '2026-10-02', serialNumber: 'SER-1' });
    expect(res.body.certificate.reference).toMatch(/^CERT-DISP-[0-9A-F]{8}$/);
    expect(res.body.certificate.verificationHash).toMatch(/^[0-9a-f]{64}$/);

    expect((await request(app).get(`/api/assets/${a.id}`).set(h)).body.asset.status).toBe('DISPOSED');
    expect((await request(app).patch(`/api/assets/${a.id}`).set(h).send({ name: 'renamed' })).status).toBe(409);
    expect((await request(app).post(`/api/assets/${a.id}/dispose`).set(h).send({ ...body, confirmed: true })).status).toBe(409);
    expect((await request(app).patch(`/api/assets/${a.id}`).set(h).send({ status: 'ACTIVE' })).status).toBe(409);

    const pdf = await request(app).get(`/api/assets/${a.id}/certificate?format=pdf`).set(h).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect(await prisma.auditLog.count({ where: { targetId: a.id, action: 'DISPOSAL' } })).toBe(1);
  });

  it('can only change status through valid transitions (DISPOSED is not reachable via PATCH)', async () => {
    const admin = await user('SUPER_ADMIN');
    const a = await asset(admin);
    const res = await request(app).patch(`/api/assets/${a.id}`).set(await as(admin)).send({ status: 'DISPOSED' });
    expect(res.status).toBe(400);
  });

  it('serves a QR label as JSON and PDF', async () => {
    const admin = await user('SUPER_ADMIN');
    const a = await asset(admin, { assetId: 'HW-9' });
    const h = await as(admin);
    const json = await request(app).get(`/api/assets/${a.id}/label`).set(h).expect(200);
    expect(json.body.label).toMatchObject({ assetId: 'HW-9', qrPayload: 'HW-9' });
    expect(json.body.label.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const pdf = await request(app).get(`/api/assets/${a.id}/label?format=pdf`).set(h).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('previews and imports assets from CSV', async () => {
    const admin = await user('SUPER_ADMIN');
    await user('MEMBER', { name: 'Taylor Walsh' });
    await asset(admin, { assetId: 'HW-010' });
    const h = await as(admin);
    const csv = [
      'assetId,name,category,status,assignee,department,purchaseCost,vendor',
      'HW-010,Dell XPS 15,Hardware,Active,Taylor Walsh,Engineering,1800,Dell', // duplicate of an existing asset
      'SW-010,Jira Cloud,Software,Active,,DevOps,2400,Atlassian',
      'DG-010,Cloudflare DNS,Digital,Active,Nobody Known,Network,0,Cloudflare',
      'NEW-1,Chair,Furniture,Bogus,,,abc,',
    ].join('\n');

    const preview = await request(app).post('/api/assets/import/preview').set(h).send({ csv }).expect(200);
    expect(preview.body).toMatchObject({ total: 4, valid: 2, skipped: 2 });
    expect(preview.body.rows[0].errors[0]).toMatch(/already exists/);
    expect(preview.body.rows[2].warnings.join(' ')).toMatch(/Nobody Known/);
    expect(preview.body.rows[3].errors.length).toBeGreaterThanOrEqual(2);
    expect(await prisma.asset.count()).toBe(1); // preview never writes

    const imported = await request(app).post('/api/assets/import').set(h).send({ csv }).expect(201);
    expect(imported.body).toMatchObject({ imported: 2, skipped: 2 });
    expect(await prisma.asset.count()).toBe(3);
    expect(await prisma.department.count({ where: { name: { in: ['DevOps', 'Network'] } } })).toBe(2);

    expect((await request(app).post('/api/assets/import/preview').set(h).send({ csv: 'foo,bar\n1,2' })).status).toBe(400);
  });
});

// ─── Credentials ────────────────────────────────────────────────────────────

describeWithDb('Credentials (v2 design)', () => {
  it('stores type/policy, keeps secrets out of responses and tracks versions', async () => {
    const admin = await user('SUPER_ADMIN');
    const c = await credential(admin, { credType: 'API_KEY', systemHost: 'AWS RDS', username: 'admin', policyRef: 'Emergency break-glass access', expiresAt: '2030-12-07' });
    expect(c).toMatchObject({ credType: 'API_KEY', policyRef: 'Emergency break-glass access', currentVersion: 1, shareCount: 0 });
    expect(JSON.stringify(c)).not.toContain('first-secret');

    const h = await as(admin);
    await request(app).patch(`/api/credentials/${c.id}`).set(h).send({ secret: 'second-secret' }).expect(200);
    const versions = (await request(app).get(`/api/credentials/${c.id}/versions`).set(h).expect(200)).body.versions;
    expect(versions.map((v: any) => [v.version, v.isActive])).toEqual([[2, true], [1, false]]);
    expect(versions[0].changedBy.name).toBe(admin.name);

    expect((await request(app).post(`/api/credentials/${c.id}/reveal`).set(h)).body.secret).toBe('second-secret');
    await request(app).post(`/api/credentials/${c.id}/versions/${versions[1].id}/restore`).set(h).expect(200);
    expect((await request(app).post(`/api/credentials/${c.id}/reveal`).set(h)).body.secret).toBe('first-secret');
    const after = (await request(app).get(`/api/credentials/${c.id}/versions`).set(h)).body.versions;
    expect(after.find((v: any) => v.isActive).version).toBe(1);
    expect((await request(app).post(`/api/credentials/${c.id}/versions/${versions[0].id}/reveal`).set(h)).body.secret).toBe('second-secret');
    expect(await prisma.auditLog.count({ where: { targetId: c.id, action: 'RESTORE' } })).toBe(1);
  });

  it('only COPY and above may reveal or copy; VIEW can see the record but not the secret', async () => {
    const admin = await user('SUPER_ADMIN');
    const viewer = await user('MEMBER');
    const copier = await user('MEMBER');
    const c = await credential(admin);
    await prisma.credentialAccess.createMany({
      data: [{ credentialId: c.id, userId: viewer.id, permission: 'VIEW' }, { credentialId: c.id, userId: copier.id, permission: 'COPY' }],
    });

    expect((await request(app).get(`/api/credentials/${c.id}`).set(await as(viewer))).body.credential.myPermission).toBe('VIEW');
    expect((await request(app).post(`/api/credentials/${c.id}/reveal`).set(await as(viewer))).status).toBe(403);
    expect((await request(app).post(`/api/credentials/${c.id}/copy`).set(await as(viewer))).status).toBe(403);
    expect((await request(app).get(`/api/credentials/${c.id}/versions`).set(await as(copier))).status).toBe(403);

    const copy = await request(app).post(`/api/credentials/${c.id}/copy`).set(await as(copier));
    expect(copy.body.secret).toBe('first-secret');
    expect((await request(app).post(`/api/credentials/${c.id}/reveal`).set(await as(copier))).status).toBe(200);
    expect((await prisma.auditLog.findMany({ where: { targetId: c.id, userId: copier.id } })).map((l) => l.action).sort()).toEqual(['COPY', 'REVEAL']);
  });

  it('requires the password for reveals when the user turned on re-authentication', async () => {
    const admin = await user('SUPER_ADMIN');
    const c = await credential(admin);
    const h = await as(admin);
    await request(app).patch('/api/users/me/preferences').set(h).send({ security: { requireReauthForReveals: true } }).expect(200);

    const missing = await request(app).post(`/api/credentials/${c.id}/reveal`).set(h);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('REAUTH_REQUIRED');
    expect((await request(app).post(`/api/credentials/${c.id}/reveal`).set(h).send({ password: 'wrong' })).status).toBe(401);
    expect((await request(app).post(`/api/credentials/${c.id}/reveal`).set(h).send({ password: PASSWORD })).body.secret).toBe('first-secret');
    expect(await prisma.auditLog.count({ where: { targetId: c.id, action: 'REVEAL' } })).toBe(1); // denied attempts are not logged as reveals
  });

  it('decommission destroys the secret and every previous version', async () => {
    const admin = await user('SUPER_ADMIN');
    const c = await credential(admin);
    const h = await as(admin);
    await request(app).patch(`/api/credentials/${c.id}`).set(h).send({ secret: 'v2' }).expect(200);
    await request(app).delete(`/api/credentials/${c.id}`).set(h).expect(204);

    const row = await prisma.credential.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ encryptedValue: '', iv: '', authTag: '' });
    expect(row.deletedAt).not.toBeNull();
    expect(await prisma.credentialVersion.count({ where: { credentialId: c.id } })).toBe(0);
    expect((await request(app).post(`/api/credentials/${c.id}/reveal`).set(h)).status).toBe(404);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { targetId: c.id, action: 'DELETE' } })).metadata).toMatchObject({ decommissioned: true });
  });

  it('filters by type, reports facets and generates secrets', async () => {
    const admin = await user('SUPER_ADMIN');
    await credential(admin, { friendlyName: 'A', credType: 'LOGIN' });
    await credential(admin, { friendlyName: 'B', credType: 'SSH_KEY' });
    await credential(admin, { friendlyName: 'C' });
    const h = await as(admin);

    const ssh = await request(app).get('/api/credentials?credType=ssh_key').set(h).expect(200);
    expect(ssh.body.credentials.map((c: any) => c.friendlyName)).toEqual(['B']);
    const facets = (await request(app).get('/api/credentials/facets').set(h).expect(200)).body.types;
    expect(facets).toHaveLength(7);
    expect(facets.find((t: any) => t.value === 'OTHER').count).toBe(1);
    expect(facets.find((t: any) => t.value === 'CERTIFICATE').count).toBe(0);

    const gen = (await request(app).post('/api/credentials/generate-secret').set(h).send({ length: 32, symbols: false })).body.secret;
    expect(gen).toMatch(/^[A-Za-z0-9]{32}$/);
    expect((await request(app).post('/api/credentials/generate-secret').set(h).send({ length: 2 })).status).toBe(400);
    expect((await request(app).post('/api/credentials/generate-secret').set(h)).body.secret).toHaveLength(20);
  });

  it('previews and imports credentials from CSV without echoing secrets', async () => {
    const admin = await user('SUPER_ADMIN');
    const h = await as(admin);
    const csv = [
      'friendlyName,system,username,secret,credType',
      'GitHub Actions Token,github.com,ci-bot,ghp_XXXXXXXX,Token',
      'Stripe API Key,stripe.com,,"sk_live,with,commas",API Key',
      'Prod SSH Key,prod.servers.io,deploy,-----BEGIN RSA PRIVATE KEY-----,SSH Key',
      ',nothing,,,',
      'Bad Type,x,,s3cret,Banana',
    ].join('\n');

    const preview = await request(app).post('/api/credentials/import/preview').set(h).send({ csv }).expect(200);
    expect(preview.body).toMatchObject({ total: 5, valid: 3, skipped: 2 });
    expect(JSON.stringify(preview.body)).not.toContain('ghp_XXXXXXXX');
    expect(preview.body.rows.map((r: any) => r.credType).slice(0, 3)).toEqual(['TOKEN', 'API_KEY', 'SSH_KEY']);
    expect(await prisma.credential.count()).toBe(0);

    const done = await request(app).post('/api/credentials/import').set(h).send({ csv }).expect(201);
    expect(done.body).toMatchObject({ imported: 3, skipped: 2 });
    expect(JSON.stringify(done.body)).not.toContain('sk_live');
    const stripe = await prisma.credential.findFirstOrThrow({ where: { friendlyName: 'Stripe API Key' } });
    expect((await request(app).post(`/api/credentials/${stripe.id}/reveal`).set(h)).body.secret).toBe('sk_live,with,commas');
    expect(await prisma.credentialVersion.count()).toBe(3);

    expect((await request(app).post('/api/credentials/import/preview').set(h).send({ csv: 'name,pw\na,b' })).status).toBe(400);
  });

  it('lets an owner/MANAGE holder share and audits SHARE / REVOKE_SHARE; others cannot', async () => {
    const owner = await user('MEMBER', { name: 'Toby Alabi' });
    const target = await user('MEMBER');
    const outsider = await user('MEMBER');
    const c = await credential(owner);
    const h = await as(owner);

    const empty = (await request(app).get(`/api/credentials/${c.id}/access`).set(h).expect(200)).body;
    expect(empty.owner.name).toBe('Toby Alabi');
    expect(empty.access.filter((a: any) => !a.isOwner)).toHaveLength(0);

    await request(app).post(`/api/credentials/${c.id}/access`).set(h).send({ userId: target.id, permission: 'COPY' }).expect(201);
    expect((await request(app).get(`/api/credentials`).set(h)).body.credentials[0].shareCount).toBe(1);
    expect((await request(app).post(`/api/credentials/${c.id}/access`).set(await as(outsider)).send({ userId: target.id })).status).toBe(403);
    expect((await request(app).post(`/api/credentials/${c.id}/access`).set(await as(target)).send({ userId: outsider.id })).status).toBe(403); // COPY is not enough to share
    expect((await request(app).delete(`/api/credentials/${c.id}/access/${owner.id}`).set(h)).status).toBe(409);

    await request(app).delete(`/api/credentials/${c.id}/access/${target.id}`).set(h).expect(204);
    expect((await prisma.auditLog.findMany({ where: { targetId: c.id } })).map((l) => l.action).sort()).toEqual(['CREATE', 'REVOKE_SHARE', 'SHARE']);
  });
});

// ─── Audit logs ─────────────────────────────────────────────────────────────

describeWithDb('Audit logs (v2 design)', () => {
  async function seedLogs(admin: { id: string }) {
    const rows = ['CREATE', 'EDIT', 'UPDATE', 'DELETE', 'REVEAL', 'LOGIN'].map((action, i) => ({
      action, targetType: i === 5 ? 'SESSION' : 'CREDENTIAL', targetId: `t${i}`, userId: admin.id,
    }));
    await prisma.auditLog.createMany({ data: rows });
  }

  it('filters by several actions (EDIT also matches legacy UPDATE), entity type and text', async () => {
    const admin = await user('SUPER_ADMIN', { name: 'Stephen Garba' });
    await seedLogs(admin);
    const h = await as(admin);

    const multi = await request(app).get('/api/audit-logs?action=CREATE,EDIT').set(h).expect(200);
    expect(multi.body.items.map((l: any) => l.action).sort()).toEqual(['CREATE', 'EDIT', 'EDIT']);
    expect((await request(app).get('/api/audit-logs?entityType=SESSION').set(h)).body.items).toHaveLength(1);
    expect((await request(app).get('/api/audit-logs?search=stephen').set(h)).body.items).toHaveLength(6);
    expect((await request(app).get('/api/audit-logs?search=zzz').set(h)).body.items).toHaveLength(0);
    expect((await request(app).get('/api/audit-logs?search=t3').set(h)).body.items.map((l: any) => l.action)).toEqual(['DELETE']);
  });

  it('reports per-action counts for all 15 actions', async () => {
    const admin = await user('SUPER_ADMIN');
    await seedLogs(admin);
    const { actions } = (await request(app).get('/api/audit-logs/facets').set(await as(admin)).expect(200)).body;
    expect(actions).toHaveLength(15);
    expect(actions.find((a: any) => a.value === 'EDIT').count).toBe(2);
    expect(actions.find((a: any) => a.value === 'CHECKOUT').count).toBe(0);
  });

  it('returns a detail entry with a description, and 404s for unknown IDs', async () => {
    const admin = await user('SUPER_ADMIN');
    const log = await prisma.auditLog.create({ data: { action: 'CREATE', targetType: 'CREDENTIAL', userId: admin.id, targetId: 'x' } });
    const res = await request(app).get(`/api/audit-logs/${log.id}`).set(await as(admin)).expect(200);
    expect(res.body.log).toMatchObject({ id: log.id, action: 'CREATE', description: 'A new entity was registered on the platform.', immutable: true });
    expect((await request(app).get('/api/audit-logs/nope').set(await as(admin))).status).toBe(404);
  });

  it('exports CSV and PDF (SUPER_ADMIN only)', async () => {
    const admin = await user('SUPER_ADMIN');
    const manager = await user('MANAGER');
    await seedLogs(admin);
    const csv = await request(app).get('/api/audit-logs/export').set(await as(admin)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toBe('ID,Timestamp,User Email,User Name,Action,Target Type,Target ID,Target Name');
    expect(csv.text).toContain(',EDIT,'); // legacy UPDATE is exported as EDIT

    const pdf = await request(app).get('/api/audit-logs/export?format=pdf').set(await as(admin)).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((await request(app).get('/api/audit-logs/export').set(await as(manager))).status).toBe(403);
  });
});

// ─── Users, settings, 2FA ───────────────────────────────────────────────────

describeWithDb('Users & settings (v2 design)', () => {
  it('lists with search/role/status filters, shows teams, and reports header stats', async () => {
    const admin = await user('SUPER_ADMIN', { name: 'Stephen Garba' });
    const mgr = await user('MANAGER', { name: 'Nkechi Ekwe' });
    await user('MEMBER', { name: 'Adaobi Nwosu', isActive: false }); // deactivated
    const pending = await prisma.user.create({ data: { email: 'p@test.com', name: 'Pending Pat', passwordHash, role: 'MEMBER', isActive: false, inviteTokenHash: 'h' } });
    const team = await prisma.team.create({ data: { name: 'Platform', createdById: admin.id, members: { create: [{ userId: mgr.id }] } } });
    const h = await as(admin);

    const stats = (await request(app).get('/api/users/stats').set(h).expect(200)).body;
    expect(stats).toMatchObject({ total: 4, active: 2, pending: 1, deactivated: 1 });
    expect(stats.roles.find((r: any) => r.value === 'MANAGER').count).toBe(1);

    const names = async (qs: string) => ((await request(app).get(`/api/users?${qs}`).set(h).expect(200)).body.users as any[]).map((u) => u.name).sort();
    expect(await names('status=PENDING')).toEqual(['Pending Pat']);
    expect(await names('status=DEACTIVATED')).toEqual(['Adaobi Nwosu']);
    expect(await names('status=ACTIVE')).toEqual(['Nkechi Ekwe', 'Stephen Garba']);
    expect(await names('role=MANAGER,SUPER_ADMIN')).toEqual(['Nkechi Ekwe', 'Stephen Garba']);
    expect(await names('search=garba')).toEqual(['Stephen Garba']);

    const all = (await request(app).get('/api/users').set(h)).body.users as any[];
    expect(all.find((u) => u.id === mgr.id).teams).toEqual([{ id: team.id, name: 'Platform' }]);
    expect(all.find((u) => u.id === pending.id).status).toBe('PENDING');
    expect(JSON.stringify(all)).not.toContain('inviteTokenHash');
  });

  it('shows user details with assigned assets and shared credentials (direct and via team)', async () => {
    const admin = await user('SUPER_ADMIN');
    const bob = await user('MEMBER');
    const a = await asset(admin, { assigneeId: bob.id });
    const c1 = await credential(admin, { friendlyName: 'Direct', credType: 'LOGIN' });
    const c2 = await credential(admin, { friendlyName: 'ViaTeam', credType: 'TOKEN' });
    await prisma.credentialAccess.create({ data: { credentialId: c1.id, userId: bob.id, permission: 'VIEW' } });
    const team = await prisma.team.create({ data: { name: 'T', createdById: admin.id, members: { create: [{ userId: bob.id }] } } });
    await prisma.teamCredential.create({ data: { teamId: team.id, credentialId: c2.id, permission: 'COPY' } });

    const res = await request(app).get(`/api/users/${bob.id}`).set(await as(admin)).expect(200);
    expect(res.body.user.assignedAssets).toEqual([expect.objectContaining({ id: a.id, assetId: a.assetId })]);
    const shared = res.body.user.sharedCredentials.map((c: any) => [c.friendlyName, c.permission]).sort();
    expect(shared).toEqual([['Direct', 'VIEW'], ['ViaTeam', 'COPY']]);
    expect(res.body.user.teams).toHaveLength(1);
  });

  it('invites with a department, edits email/department, and rejects email collisions', async () => {
    const admin = await user('SUPER_ADMIN');
    const other = await user('MEMBER', { email: 'taken@test.com' });
    const h = await as(admin);
    const inv = await request(app).post('/api/users/invite').set(h).send({ email: 'toheeb@kickoff.africa', name: 'Toheeb', role: 'MEMBER', department: 'Engineering' });
    expect(inv.status).toBe(201);
    expect(inv.body.user).toMatchObject({ department: 'Engineering', status: 'PENDING' });
    expect(await prisma.department.count({ where: { name: 'Engineering' } })).toBe(1);

    const edit = await request(app).patch(`/api/users/${other.id}`).set(h).send({ email: 'new@test.com', department: 'IT', role: 'MANAGER' }).expect(200);
    expect(edit.body.user).toMatchObject({ email: 'new@test.com', department: 'IT', role: 'MANAGER' });
    expect((await request(app).patch(`/api/users/${other.id}`).set(h).send({ email: 'toheeb@kickoff.africa' })).status).toBe(409);
  });

  it('deactivating a user ends sessions and flags their assets for recovery; reactivation restores access', async () => {
    const admin = await user('SUPER_ADMIN');
    const bob = await user('MEMBER');
    const a = await asset(admin, { assigneeId: bob.id });
    await prisma.session.create({ data: { userId: bob.id, refreshToken: 'rt', expiresAt: new Date(Date.now() + 1e6) } });
    const h = await as(admin);

    const res = await request(app).post(`/api/users/${bob.id}/deactivate`).set(h).expect(200);
    expect(res.body).toMatchObject({ flaggedAssets: 1, user: { status: 'DEACTIVATED' } });
    expect(await prisma.session.count({ where: { userId: bob.id } })).toBe(0);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: a.id } })).recoveryRequestedAt).not.toBeNull();

    const back = await request(app).post(`/api/users/${bob.id}/reactivate`).set(h).expect(200);
    expect(back.body.user.status).toBe('ACTIVE');
    expect((await request(app).post(`/api/users/${bob.id}/reactivate`).set(h)).status).toBe(404);
  });

  it('offers a user directory to any signed-in user', async () => {
    const admin = await user('SUPER_ADMIN', { name: 'Paul Olatunde' });
    const viewer = await user('VIEWER');
    const res = await request(app).get('/api/users/lookup?search=paul').set(await as(viewer)).expect(200);
    expect(res.body.users).toEqual([expect.objectContaining({ id: admin.id, name: 'Paul Olatunde' })]);
    expect(res.body.users[0]).not.toHaveProperty('passwordHash');
    expect((await request(app).get('/api/users').set(await as(viewer))).status).toBe(403);
  });

  it('reads and updates grouped preferences with validation', async () => {
    const u = await user('MEMBER');
    const h = await as(u);
    const defaults = (await request(app).get('/api/users/me/preferences').set(h).expect(200)).body.preferences;
    expect(defaults.notifications).toMatchObject({ transactionAlerts: true, criticalEventsOnly: false });
    expect(defaults.appearance).toMatchObject({ theme: 'SYSTEM', fontSize: 'DEFAULT', secretMask: 'BULLETS' });
    expect(defaults.security).toMatchObject({ twoFactorEnabled: false, sessionTimeoutMinutes: null });

    const res = await request(app).patch('/api/users/me/preferences').set(h).send({
      appearance: { theme: 'DARK', secretMask: 'ASTERISKS' },
      notifications: { criticalEventsOnly: true, slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x' },
      security: { sessionTimeoutMinutes: 30 },
    }).expect(200);
    expect(res.body.preferences.appearance).toMatchObject({ theme: 'DARK', secretMask: 'ASTERISKS', fontSize: 'DEFAULT' });
    expect(res.body.preferences.security.sessionTimeoutMinutes).toBe(30);

    expect((await request(app).patch('/api/users/me/preferences').set(h).send({ appearance: { theme: 'NEON' } })).status).toBe(400);
    expect((await request(app).patch('/api/users/me/preferences').set(h).send({ notifications: { slackWebhookUrl: 'https://evil.example.com/x' } })).status).toBe(400);
    expect((await request(app).patch('/api/users/me/preferences').set(h).send({})).status).toBe(400);
  });

  it('enforces the per-user inactivity timeout on refresh', async () => {
    const u = await user('MEMBER');
    await prisma.userPreference.create({ data: { userId: u.id, sessionTimeoutMin: 5 } });
    const login = await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD }).expect(200);
    await prisma.session.updateMany({ where: { userId: u.id }, data: { lastActiveAt: new Date(Date.now() - 10 * 60_000) } });
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/inactivity/);
  });

  it('runs the full TOTP lifecycle: setup, enable, login challenge, disable', async () => {
    const u = await user('MEMBER');
    const h = await as(u);
    const setup = await request(app).post('/api/users/me/2fa/setup').set(h).expect(201);
    expect(setup.body.otpauthUrl).toContain(setup.body.secret);
    // The secret is stored encrypted, never in plaintext.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).totpSecret).not.toContain(setup.body.secret);

    expect((await request(app).post('/api/users/me/2fa/enable').set(h).send({ code: '000000' })).status).toBe(401);
    await request(app).post('/api/users/me/2fa/enable').set(h).send({ code: totpCode(setup.body.secret) }).expect(200);
    expect((await request(app).get('/api/users/me/preferences').set(h)).body.preferences.security.twoFactorEnabled).toBe(true);

    const noCode = await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD });
    expect(noCode.status).toBe(401);
    expect(noCode.body.error.code).toBe('TOTP_REQUIRED');
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD, totpCode: '000000' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: 'wrong-password', totpCode: totpCode(setup.body.secret) })).status).toBe(401);
    const ok = await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD, totpCode: totpCode(setup.body.secret) });
    expect(ok.status).toBe(200);

    expect((await request(app).post('/api/users/me/2fa/disable').set(h).send({ password: 'nope' })).status).toBe(401);
    await request(app).post('/api/users/me/2fa/disable').set(h).send({ password: PASSWORD }).expect(200);
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(200);
  });

  it('records login history (flagging failures and new IPs) and LOGIN/LOGOUT audit entries', async () => {
    const u = await user('MEMBER');
    const agent = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' };
    await request(app).post('/api/auth/login').set(agent).send({ email: u.email, password: 'wrong-password' }).expect(401);
    const login = await request(app).post('/api/auth/login').set(agent).send({ email: u.email, password: PASSWORD }).expect(200);

    const hist = await request(app).get('/api/users/me/login-history').set({ Authorization: `Bearer ${login.body.accessToken}` }).expect(200);
    expect(hist.body.events.map((e: any) => [e.success, e.status]).sort()).toEqual([[false, 'THREAT'], [true, 'OK']]);
    expect(hist.body.events[0].deviceName).toContain('Chrome');

    // A login from a different IP after a previous one is flagged.
    await prisma.loginEvent.updateMany({ where: { userId: u.id, success: true }, data: { ipAddress: '203.0.113.9' } });
    await request(app).post('/api/auth/login').set(agent).send({ email: u.email, password: PASSWORD }).expect(200);
    expect(await prisma.loginEvent.count({ where: { userId: u.id, success: true, suspicious: true } })).toBe(1);

    await request(app).post('/api/auth/logout').set({ Authorization: `Bearer ${login.body.accessToken}` });
    const actions = (await prisma.auditLog.findMany({ where: { userId: u.id } })).map((l) => l.action);
    expect(actions.filter((a) => a === 'LOGIN')).toHaveLength(2);
    expect(actions).toContain('LOGOUT');
  });

  it('deletes the caller’s own account only with the right password and no owned resources', async () => {
    const admin = await user('SUPER_ADMIN');
    const owner = await user('MEMBER');
    const clean = await user('MEMBER');
    await asset(owner);

    expect((await request(app).delete('/api/users/me').set(await as(clean)).send({})).status).toBe(400);
    expect((await request(app).delete('/api/users/me').set(await as(clean)).send({ password: 'wrong' })).status).toBe(401);
    expect((await request(app).delete('/api/users/me').set(await as(owner)).send({ password: PASSWORD })).status).toBe(409);
    expect((await request(app).delete('/api/users/me').set(await as(admin)).send({ password: PASSWORD })).status).toBe(403); // last SUPER_ADMIN
    await request(app).delete('/api/users/me').set(await as(clean)).send({ password: PASSWORD }).expect(204);
    expect(await prisma.user.count({ where: { id: clean.id } })).toBe(0);
  });
});

// ─── Teams ──────────────────────────────────────────────────────────────────

describeWithDb('Teams', () => {
  it('creates, lists, edits membership and deletes a team (MANAGER+ only)', async () => {
    const admin = await user('SUPER_ADMIN');
    const [a, b, c] = [await user('MEMBER', { name: 'A' }), await user('MEMBER', { name: 'B' }), await user('VIEWER', { name: 'C' })];
    const h = await as(admin);

    expect((await request(app).get('/api/teams').set(await as(a))).status).toBe(403);
    expect((await request(app).post('/api/teams').set(h).send({ name: '' })).status).toBe(400);
    expect((await request(app).post('/api/teams').set(h).send({ name: 'Bad', memberIds: ['ghost'] })).status).toBe(400);

    const created = await request(app).post('/api/teams').set(h).send({ name: 'Platform Engineering', description: 'Core infra', memberIds: [a.id, b.id] }).expect(201);
    const id = created.body.team.id;
    expect(created.body.team.members.map((m: any) => m.name).sort()).toEqual(['A', 'B']);
    expect((await request(app).post('/api/teams').set(h).send({ name: 'Platform Engineering' })).status).toBe(409);

    const list = (await request(app).get('/api/teams?search=infra').set(h).expect(200)).body.teams;
    expect(list).toEqual([expect.objectContaining({ name: 'Platform Engineering', memberCount: 2, assetCount: 0, credentialCount: 0 })]);

    const upd = await request(app).patch(`/api/teams/${id}`).set(h).send({ name: 'Platform', memberIds: [b.id, c.id] }).expect(200);
    expect(upd.body.team.name).toBe('Platform');
    expect(upd.body.team.members.map((m: any) => m.name).sort()).toEqual(['B', 'C']);

    await request(app).delete(`/api/teams/${id}`).set(h).expect(204);
    expect((await request(app).get(`/api/teams/${id}`).set(h)).status).toBe(404);
    expect(await prisma.teamMember.count()).toBe(0);
  });

  it('team assignments grant members access to assets and credentials at the assigned level', async () => {
    const admin = await user('SUPER_ADMIN');
    const member = await user('MEMBER');
    const outsider = await user('MEMBER');
    const a = await asset(admin);
    const c = await credential(admin);
    const h = await as(admin);
    const team = (await request(app).post('/api/teams').set(h).send({ name: 'T', memberIds: [member.id] })).body.team;

    expect((await request(app).get(`/api/assets/${a.id}`).set(await as(member))).status).toBe(403);
    await request(app).post(`/api/teams/${team.id}/assets`).set(h).send({ assetId: a.id, permission: 'EDIT' }).expect(201);
    await request(app).post(`/api/teams/${team.id}/credentials`).set(h).send({ credentialId: c.id, permission: 'COPY' }).expect(201);

    expect((await request(app).get(`/api/assets/${a.id}`).set(await as(member))).status).toBe(200);
    expect((await request(app).patch(`/api/assets/${a.id}`).set(await as(member)).send({ notes: 'ok' })).status).toBe(200);
    expect((await request(app).get(`/api/assets/${a.id}`).set(await as(outsider))).status).toBe(403);
    expect((await request(app).post(`/api/credentials/${c.id}/reveal`).set(await as(member))).body.secret).toBe('first-secret');
    expect((await request(app).patch(`/api/credentials/${c.id}`).set(await as(member)).send({ username: 'x' })).status).toBe(403); // COPY < EDIT
    expect((await request(app).get('/api/credentials').set(await as(member))).body.credentials).toHaveLength(1);

    const detail = (await request(app).get(`/api/teams/${team.id}`).set(h)).body.team;
    expect(detail.assets[0]).toMatchObject({ id: a.id, permission: 'EDIT' });
    expect(detail.credentials[0]).toMatchObject({ id: c.id, permission: 'COPY' });

    await request(app).delete(`/api/teams/${team.id}/assets/${a.id}`).set(h).expect(204);
    expect((await request(app).get(`/api/assets/${a.id}`).set(await as(member))).status).toBe(403);
    expect((await request(app).delete(`/api/teams/${team.id}/assets/${a.id}`).set(h)).status).toBe(404);
    const actions = (await prisma.auditLog.findMany({ where: { targetId: a.id } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['SHARE', 'REVOKE_SHARE']));
  });
});

// ─── Requests ───────────────────────────────────────────────────────────────

describeWithDb('Requests', () => {
  it('approving an access request grants the requested level and is audited', async () => {
    const admin = await user('SUPER_ADMIN');
    const mgr = await user('MANAGER');
    const member = await user('MEMBER');
    const c = await credential(admin);
    const mh = await as(member);

    expect((await request(app).post('/api/requests').set(mh).send({ type: 'CREDENTIAL_ACCESS', credentialId: c.id })).status).toBe(400); // reason required
    expect((await request(app).post('/api/requests').set(mh).send({ type: 'CREDENTIAL_ACCESS', credentialId: c.id, reason: 'x'.repeat(201) })).status).toBe(400);
    const created = await request(app).post('/api/requests').set(mh).send({ type: 'CREDENTIAL_ACCESS', credentialId: c.id, reason: 'Need to rotate the DB password' });
    expect(created.status).toBe(201);
    expect(created.body.request).toMatchObject({ status: 'PENDING', target: { kind: 'CREDENTIAL', label: 'Prod DB Admin' } });
    expect((await request(app).post('/api/requests').set(mh).send({ type: 'CREDENTIAL_ACCESS', credentialId: c.id, reason: 'again' })).status).toBe(409);
    expect((await request(app).get('/api/requests/pending-count').set(mh)).body.pending).toBe(1);

    const rid = created.body.request.id;
    expect((await request(app).post(`/api/requests/${rid}/approve`).set(mh).send({})).status).toBe(403);
    const approved = await request(app).post(`/api/requests/${rid}/approve`).set(await as(mgr)).send({ permission: 'COPY' });
    expect(approved.status).toBe(200);
    expect(approved.body.request).toMatchObject({ status: 'APPROVED', grantedPermission: 'COPY', reviewedBy: { id: mgr.id } });
    expect((await request(app).post(`/api/credentials/${c.id}/reveal`).set(mh)).body.secret).toBe('first-secret');
    expect((await request(app).post(`/api/requests/${rid}/approve`).set(await as(mgr)).send({})).status).toBe(409);
    expect((await request(app).get('/api/requests/pending-count').set(mh)).body.pending).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'APPROVE_REQUEST', targetId: c.id } })).toBe(1);
    // Already has access now
    expect((await request(app).post('/api/requests').set(mh).send({ type: 'CREDENTIAL_ACCESS', credentialId: c.id, reason: 'x' })).status).toBe(409);
  });

  it('denies, cancels, scopes visibility and handles purchase requisitions', async () => {
    const admin = await user('SUPER_ADMIN');
    const mgr = await user('MANAGER');
    const m1 = await user('MEMBER');
    const m2 = await user('MEMBER');
    const a = await asset(admin);

    const r1 = (await request(app).post('/api/requests').set(await as(m1)).send({ type: 'ASSET_ACCESS', assetId: a.id, reason: 'Need laptop' })).body.request;
    const denied = await request(app).post(`/api/requests/${r1.id}/deny`).set(await as(mgr)).send({ note: 'Not this quarter' });
    expect(denied.body.request).toMatchObject({ status: 'DENIED', reviewNote: 'Not this quarter' });
    expect((await request(app).get(`/api/assets/${a.id}`).set(await as(m1))).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: 'DENY_REQUEST' } })).toBe(1);

    const r2 = (await request(app).post('/api/requests').set(await as(m1)).send({ type: 'ASSET_ACCESS', assetId: a.id, reason: 'Retry' })).body.request;
    expect((await request(app).post(`/api/requests/${r2.id}/cancel`).set(await as(m2))).status).toBe(404); // not visible to others
    expect((await request(app).post(`/api/requests/${r2.id}/cancel`).set(await as(m1))).body.request.status).toBe('CANCELLED');

    const purchase = await request(app).post('/api/requests').set(await as(m2)).send({ type: 'PURCHASE', itemDescription: 'Dell 34" Ultrawide Monitor', purchaseCost: 560000, category: 'hardware', justification: 'Current monitor failing' });
    expect(purchase.status).toBe(201);
    expect(purchase.body.request).toMatchObject({ type: 'PURCHASE', purchaseCost: 560000, category: 'Hardware' });
    expect((await request(app).post('/api/requests').set(await as(m2)).send({ type: 'PURCHASE', itemDescription: 'x', category: 'Nope' })).status).toBe(400);

    expect((await request(app).get('/api/requests').set(await as(m2))).body.total).toBe(1);
    expect((await request(app).get('/api/requests').set(await as(mgr))).body.total).toBe(3);
    expect((await request(app).get('/api/requests?status=PENDING&type=PURCHASE').set(await as(mgr))).body.requests).toHaveLength(1);
    expect((await request(app).get('/api/requests?search=monitor').set(await as(mgr))).body.requests).toHaveLength(1);
    expect((await request(app).post(`/api/requests/${purchase.body.request.id}/approve`).set(await as(mgr)).send({})).body.request.grantedPermission).toBeNull();
  });
});

// ─── API keys ───────────────────────────────────────────────────────────────

describeWithDb('API keys', () => {
  it('shows the key once, stores only a hash and masks it afterwards', async () => {
    const u = await user('SUPER_ADMIN');
    const h = await as(u);
    const created = await request(app).post('/api/api-keys').set(h).send({ name: 'CI Pipeline', scope: 'READ_ONLY' }).expect(201);
    expect(created.body.key).toMatch(/^kv_live_[A-Za-z0-9]{32}$/);
    expect(created.body.apiKey.maskedKey).toMatch(/^kv_live_\w{4}\.{10}\w{4}$/);

    const stored = await prisma.apiKey.findFirstOrThrow({ where: { userId: u.id } });
    expect(JSON.stringify(stored)).not.toContain(created.body.key);
    const list = await request(app).get('/api/api-keys').set(h).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(created.body.key);
    expect(list.body.apiKeys[0]).toMatchObject({ name: 'CI Pipeline', scope: 'READ_ONLY' });

    expect((await request(app).post('/api/api-keys').set(h).send({ name: '' })).status).toBe(400);
    await request(app).delete(`/api/api-keys/${created.body.apiKey.id}`).set(h).expect(204);
    expect((await request(app).get('/api/api-keys').set(h)).body.apiKeys).toHaveLength(0);
    expect((await request(app).delete(`/api/api-keys/${created.body.apiKey.id}`).set(h)).status).toBe(404);
  });

  it('authenticates with a key, enforces scope, fetches secrets and cannot manage keys or users', async () => {
    const u = await user('SUPER_ADMIN');
    const c = await credential(u);
    const h = await as(u);
    const ro = (await request(app).post('/api/api-keys').set(h).send({ name: 'ro', scope: 'READ_ONLY' })).body;
    const rw = (await request(app).post('/api/api-keys').set(h).send({ name: 'rw', scope: 'READ_WRITE' })).body;
    const bearer = (k: string) => ({ Authorization: `Bearer ${k}` });

    expect((await request(app).get('/api/assets').set(bearer(ro.key))).status).toBe(200);
    expect((await request(app).post('/api/assets').set(bearer(ro.key)).send({ name: 'x', category: 'Hardware' })).status).toBe(403);
    expect((await request(app).post('/api/assets').set(bearer(rw.key)).send({ name: 'x', category: 'Hardware' })).status).toBe(201);

    const reveal = await request(app).post(`/api/credentials/${c.id}/reveal`).set(bearer(ro.key));
    expect(reveal.body.secret).toBe('first-secret');
    expect((await prisma.auditLog.findFirstOrThrow({ where: { targetId: c.id, action: 'REVEAL' } })).metadata).toMatchObject({ apiKeyId: ro.apiKey.id });
    expect((await request(app).post(`/api/credentials/${c.id}/copy`).set(bearer(ro.key))).status).toBe(403);

    for (const path of ['/api/users', '/api/api-keys', '/api/users/me']) {
      expect((await request(app).get(path).set(bearer(rw.key))).status).toBe(403);
    }
    expect((await request(app).post('/api/api-keys').set(bearer(rw.key)).send({ name: 'nested' })).status).toBe(403);
    expect((await request(app).get('/api/assets').set(bearer('kv_live_' + 'x'.repeat(32)))).status).toBe(401);

    // Revoked and deactivated owners stop working immediately.
    await request(app).delete(`/api/api-keys/${ro.apiKey.id}`).set(h).expect(204);
    expect((await request(app).get('/api/assets').set(bearer(ro.key))).status).toBe(401);
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect((await request(app).get('/api/assets').set(bearer(rw.key))).status).toBe(401);
  });

  it('applies the owner’s role: a MEMBER key only sees what the member can see', async () => {
    const admin = await user('SUPER_ADMIN');
    const member = await user('MEMBER');
    await asset(admin);
    const key = (await request(app).post('/api/api-keys').set(await as(member)).send({ name: 'm', scope: 'READ_ONLY' })).body.key;
    const res = await request(app).get('/api/assets').set({ Authorization: `Bearer ${key}` }).expect(200);
    expect(res.body.assets).toHaveLength(0);
  });
});

// ─── Alert rules, webhooks, integrations ────────────────────────────────────

describeWithDb('Alert rules', () => {
  it('validates, toggles and deletes rules (SUPER_ADMIN writes, MANAGER reads)', async () => {
    const admin = await user('SUPER_ADMIN');
    const mgr = await user('MANAGER');
    const member = await user('MEMBER');
    const h = await as(admin);

    expect((await request(app).post('/api/alert-rules').set(h).send({ name: 'x', actionType: 'NOPE', threshold: 3, windowMinutes: 30 })).status).toBe(400);
    expect((await request(app).post('/api/alert-rules').set(h).send({ name: 'x', actionType: 'REVEAL', threshold: 0, windowMinutes: 30 })).status).toBe(400);
    const created = await request(app).post('/api/alert-rules').set(h).send({ name: 'Excessive Reveals', actionType: 'REVEAL', threshold: 3, windowMinutes: 30 });
    expect(created.status).toBe(201);
    expect(created.body.rule).toMatchObject({ enabled: true, actionType: 'REVEAL' });

    expect((await request(app).post('/api/alert-rules').set(await as(mgr)).send({ name: 'y', actionType: 'REVEAL', threshold: 1, windowMinutes: 1 })).status).toBe(403);
    expect((await request(app).get('/api/alert-rules').set(await as(mgr))).body.rules).toHaveLength(1);
    expect((await request(app).get('/api/alert-rules').set(await as(member))).status).toBe(403);

    const off = await request(app).patch(`/api/alert-rules/${created.body.rule.id}`).set(h).send({ enabled: false }).expect(200);
    expect(off.body.rule.enabled).toBe(false);
    expect((await request(app).patch(`/api/alert-rules/${created.body.rule.id}`).set(h).send({})).status).toBe(400);
    await request(app).delete(`/api/alert-rules/${created.body.rule.id}`).set(h).expect(204);
    expect((await request(app).delete(`/api/alert-rules/${created.body.rule.id}`).set(h)).status).toBe(404);
  });

  it('fires once per user per window when the threshold is crossed, and not when disabled', async () => {
    const admin = await user('SUPER_ADMIN');
    const c = await credential(admin);
    const h = await as(admin);
    const rule = (await request(app).post('/api/alert-rules').set(h).send({ name: 'Excessive Reveals', actionType: 'REVEAL', threshold: 3, windowMinutes: 60 })).body.rule;
    const reveal = () => request(app).post(`/api/credentials/${c.id}/reveal`).set(h).expect(200);

    await reveal();
    await reveal();
    await new Promise((r) => setTimeout(r, 150));
    expect(await prisma.alertEvent.count()).toBe(0);
    await reveal();
    await vi.waitFor(async () => expect(await prisma.alertEvent.count()).toBe(1));
    await reveal(); // still inside the same window: no duplicate alert
    await new Promise((r) => setTimeout(r, 150));
    expect(await prisma.alertEvent.count()).toBe(1);

    const events = (await request(app).get('/api/alert-rules/events').set(h).expect(200)).body.events;
    expect(events[0]).toMatchObject({ ruleId: rule.id, userId: admin.id, count: 3, rule: { name: 'Excessive Reveals' } });
    expect(events[0].user.name).toBe(admin.name);

    await prisma.alertEvent.deleteMany();
    await request(app).patch(`/api/alert-rules/${rule.id}`).set(h).send({ enabled: false }).expect(200);
    await reveal();
    await new Promise((r) => setTimeout(r, 150));
    expect(await prisma.alertEvent.count()).toBe(0);
  });
});

describeWithDb('Webhooks & integrations', () => {
  it('validates URLs and events, shows the secret once, and lets admins pause/delete', async () => {
    const admin = await user('SUPER_ADMIN');
    const mgr = await user('MANAGER');
    const h = await as(admin);
    const url = 'https://93.184.216.34/hooks/kickvault';

    expect((await request(app).post('/api/webhooks').set(h).send({ url: 'http://example.com/h', events: ['credential.created'] })).status).toBe(400);
    expect((await request(app).post('/api/webhooks').set(h).send({ url: 'https://127.0.0.1/h', events: ['credential.created'] })).status).toBe(400);
    expect((await request(app).post('/api/webhooks').set(h).send({ url, events: [] })).status).toBe(400);
    expect((await request(app).post('/api/webhooks').set(h).send({ url, events: ['made.up'] })).status).toBe(400);
    expect((await request(app).post('/api/webhooks').set(await as(mgr)).send({ url, events: ['credential.created'] })).status).toBe(403);

    const created = await request(app).post('/api/webhooks').set(h).send({ url, events: ['credential.created', 'credential.created', 'asset.deleted'] }).expect(201);
    expect(created.body.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(created.body.webhook.events).toEqual(['credential.created', 'asset.deleted']);
    expect(JSON.stringify((await request(app).get('/api/webhooks').set(h)).body)).not.toContain(created.body.secret);

    expect((await request(app).get('/api/webhooks/events').set(h)).body.events).toContain('request.approved');
    const paused = await request(app).patch(`/api/webhooks/${created.body.webhook.id}`).set(h).send({ active: false }).expect(200);
    expect(paused.body.webhook.active).toBe(false);
    await request(app).delete(`/api/webhooks/${created.body.webhook.id}`).set(h).expect(204);
    expect((await request(app).delete(`/api/webhooks/${created.body.webhook.id}`).set(h)).status).toBe(404);
  });

  it('delivers signed events only to active, subscribed webhooks', async () => {
    const admin = await user('SUPER_ADMIN');
    const h = await as(admin);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    setEventFetch(fetchMock as unknown as typeof fetch);

    const sub = (await request(app).post('/api/webhooks').set(h).send({ url: 'https://93.184.216.34/a', events: ['credential.created'] })).body;
    await request(app).post('/api/webhooks').set(h).send({ url: 'https://93.184.216.34/b', events: ['asset.created'] }).expect(201);
    const paused = (await request(app).post('/api/webhooks').set(h).send({ url: 'https://93.184.216.34/c', events: ['credential.created'] })).body;
    await request(app).patch(`/api/webhooks/${paused.webhook.id}`).set(h).send({ active: false }).expect(200);

    const c = await credential(admin, { friendlyName: 'Signed' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://93.184.216.34/a');
    expect(init.headers['X-KickVault-Event']).toBe('credential.created');
    const { createHmac } = await import('node:crypto');
    expect(init.headers['X-KickVault-Signature']).toBe(`sha256=${createHmac('sha256', sub.secret).update(init.body).digest('hex')}`);
    expect(JSON.parse(init.body)).toMatchObject({ event: 'credential.created', data: { id: c.id, name: 'Signed' } });
    expect(init.body).not.toContain('first-secret');
    await vi.waitFor(async () => expect((await prisma.webhook.findUniqueOrThrow({ where: { id: sub.webhook.id } })).lastDeliveryCode).toBe(200));
    setEventFetch(fetch);
  });

  it('connects and disconnects Slack/Teams with encrypted webhook URLs', async () => {
    const admin = await user('SUPER_ADMIN');
    const h = await as(admin);
    expect((await request(app).get('/api/integrations').set(h)).body).toMatchObject({ slack: { connected: false }, teams: { connected: false } });
    expect((await request(app).put('/api/integrations/slack').set(h).send({ webhookUrl: 'https://example.com/x' })).status).toBe(400);
    expect((await request(app).put('/api/integrations/slack').set(h).send({ webhookUrl: 'http://hooks.slack.com/x' })).status).toBe(400);
    expect((await request(app).put('/api/integrations/discord').set(h).send({ webhookUrl: 'https://hooks.slack.com/x' })).status).toBe(400);

    const url = 'https://hooks.slack.com/services/T000/B000/secretvalue';
    await request(app).put('/api/integrations/slack').set(h).send({ webhookUrl: url }).expect(200);
    await request(app).put('/api/integrations/teams').set(h).send({ webhookUrl: 'https://contoso.webhook.office.com/webhookb2/abc' }).expect(200);
    expect((await request(app).get('/api/integrations').set(h)).body).toMatchObject({ slack: { connected: true }, teams: { connected: true } });
    expect((await prisma.integration.findFirstOrThrow({ where: { provider: 'SLACK' } })).webhookUrlEnc).not.toContain('secretvalue');

    await request(app).delete('/api/integrations/slack').set(h).expect(204);
    expect((await request(app).delete('/api/integrations/slack').set(h)).status).toBe(404);
  });
});

// ─── Reports & dashboard ────────────────────────────────────────────────────

describeWithDb('Reports & dashboard', () => {
  it('summarises assets, credentials, requests and activity', async () => {
    const admin = await user('SUPER_ADMIN');
    const member = await user('MEMBER');
    await asset(admin, { purchaseDate: '2022-10-02', purchaseCost: 2_400_000, usefulLifeYears: 5, insuranceStatus: 'INSURED', warrantyExpiry: '2020-01-01' });
    await asset(admin, { category: 'Software', purchaseCost: 100 });
    await credential(admin, { credType: 'TOKEN', expiresAt: '2020-01-01' });
    await request(app).post('/api/requests').set(await as(member)).send({ type: 'PURCHASE', itemDescription: 'Monitor', category: 'Hardware' }).expect(201);

    const res = await request(app).get('/api/reports/overview').set(await as(admin)).expect(200);
    expect(res.body.assets).toMatchObject({ total: 2, totalPurchaseCost: 2_400_100, warrantyExpired: 1 });
    expect(res.body.assets.byCategory.find((c: any) => c.name === 'Software').count).toBe(1);
    expect(res.body.assets.totalBookValue).toBeGreaterThanOrEqual(0);
    expect(res.body.credentials).toMatchObject({ total: 1, expired: 1 });
    expect(res.body.requests).toEqual([{ status: 'PENDING', count: 1 }]);
    expect(res.body.activity.last30Days.find((a: any) => a.action === 'CREATE').count).toBe(3);
    expect((await request(app).get('/api/reports/overview').set(await as(member))).status).toBe(403);

    const dash = await request(app).get('/api/dashboard/stats').set(await as(admin)).expect(200);
    expect(dash.body).toMatchObject({ totalAssets: 2, totalCredentials: 1, pendingRequests: 1, overdueCheckouts: 0, pendingRecovery: 0 });
    expect(dash.body.assetsByStatus).toEqual([{ status: 'ACTIVE', count: 2 }]);
  });

  it('serves the merged OpenAPI document with the v2 endpoints', async () => {
    const res = await request(app).get('/docs.json').expect(200);
    for (const p of ['/assets/{id}/dispose', '/teams', '/requests/{id}/approve', '/api-keys', '/alert-rules', '/webhooks', '/users/me/2fa/setup', '/audit-logs/facets']) {
      expect(res.body.paths).toHaveProperty([p]);
    }
    expect(res.body.components.schemas.PermissionLevel.enum).toEqual(['VIEW', 'COPY', 'EDIT', 'MANAGE']);
  });
});
