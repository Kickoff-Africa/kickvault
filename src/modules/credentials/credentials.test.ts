import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app.js';
import { prisma } from '../../config/database.js';
import { hashPassword } from '../../services/password.service.js';
import { signAccessToken } from '../../services/token.service.js';
import { encrypt } from '../../lib/crypto.js';
import { setTransporter } from '../../services/email.service.js';
import type { Transporter } from 'nodemailer';
import type { Role } from '@prisma/client';

// Check database connectivity
const canConnect = await prisma
  .$connect()
  .then(() => true)
  .catch(() => false);
const describeWithDb = canConnect ? describe : describe.skip;

const TEST_PASSWORD = 'SuperSecure123!';
let testPasswordHash: string;

beforeAll(async () => {
  if (!canConnect) return;
  testPasswordHash = await hashPassword(TEST_PASSWORD);
  const sendMailMock = vi.fn().mockResolvedValue({});
  setTransporter({ sendMail: sendMailMock } as unknown as Transporter);
});

beforeEach(async () => {
  if (!canConnect) return;
  await prisma.auditLog.deleteMany();
  await prisma.credentialAccess.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  if (!canConnect) return;
  await prisma.auditLog.deleteMany();
  await prisma.credentialAccess.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

// --- Helpers ----------------------------------------------------------------

let userCounter = 0;

async function createTestUser(
  overrides?: Partial<{
    email: string;
    name: string;
    role: Role;
    isActive: boolean;
  }>,
) {
  userCounter++;
  return prisma.user.create({
    data: {
      email: overrides?.email ?? `credtest${userCounter}@test.com`,
      name: overrides?.name ?? `Cred Test User ${userCounter}`,
      passwordHash: testPasswordHash,
      role: overrides?.role ?? 'MEMBER',
      isActive: overrides?.isActive ?? true,
      mustChangePassword: false,
    },
  });
}

async function createSuperAdmin(email = 'credtestadmin@test.com') {
  return createTestUser({ role: 'SUPER_ADMIN', email });
}

async function getAuthToken(user: { id: string; role: Role }): Promise<string> {
  return signAccessToken({
    userId: user.id,
    role: user.role,
    sessionId: 'test-session-id',
  });
}

let credCounter = 0;

async function createTestCredential(
  createdById: string,
  overrides?: Partial<{
    friendlyName: string;
    expiresAt: Date;
    secret: string;
  }>,
) {
  credCounter++;
  const secret = overrides?.secret ?? 'test-secret';
  const encrypted = encrypt(secret);
  return prisma.credential.create({
    data: {
      friendlyName: overrides?.friendlyName ?? `Test Cred ${credCounter}`,
      systemHost: 'test.example.com',
      username: 'testuser',
      encryptedValue: encrypted.encryptedValue,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      createdById,
      expiresAt: overrides?.expiresAt,
    },
  });
}

async function grantAccess(credentialId: string, userId: string, permission = 'VIEW') {
  return prisma.credentialAccess.create({
    data: { credentialId, userId, permission: permission as any },
  });
}

// --- CRED-01/CRED-02/CRED-03: Credential create ----------------------------

describeWithDb('CRED-01/CRED-02/CRED-03: Credential create', () => {
  it('SUPER_ADMIN can create a credential (201)', async () => {
    const admin = await createSuperAdmin();
    const token = await getAuthToken(admin);

    const res = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'My Secret', systemHost: 'example.com', username: 'admin', secret: 'p@ssword' });

    expect(res.status).toBe(201);
    expect(res.body.credential).toHaveProperty('id');
    expect(res.body.credential).toHaveProperty('friendlyName', 'My Secret');
    // Must NOT expose encryption fields
    expect(res.body.credential).not.toHaveProperty('encryptedValue');
    expect(res.body.credential).not.toHaveProperty('iv');
    expect(res.body.credential).not.toHaveProperty('authTag');
    expect(res.body.credential).not.toHaveProperty('keyVersion');
    expect(res.body.credential).not.toHaveProperty('secret');
  });

  it('MEMBER can create a credential and gets auto-granted MANAGE (201)', async () => {
    const member = await createTestUser({ email: 'member-create@test.com' });
    const token = await getAuthToken(member);

    const res = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Member Cred', secret: 'my-secret' });

    expect(res.status).toBe(201);

    // Verify creator was auto-granted MANAGE
    const access = await prisma.credentialAccess.findFirst({
      where: { credentialId: res.body.credential.id, userId: member.id, permission: 'MANAGE' },
    });
    expect(access).not.toBeNull();
  });

  it('secret is encrypted in database (never plaintext)', async () => {
    const admin = await createSuperAdmin();
    const token = await getAuthToken(admin);

    const res = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Encrypt Test', secret: 'my-plaintext' });

    expect(res.status).toBe(201);

    const raw = await prisma.credential.findFirst({
      where: { id: res.body.credential.id },
    });
    expect(raw!.encryptedValue).toBeDefined();
    expect(raw!.encryptedValue).not.toBe('my-plaintext');
    // No plaintext secret field in DB
    expect((raw as any).secret).toBeUndefined();
  });

  it('expiresAt is stored and returned (CRED-06)', async () => {
    const admin = await createSuperAdmin();
    const token = await getAuthToken(admin);
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    const res = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Expiring Cred', secret: 's3cret', expiresAt: futureDate });

    expect(res.status).toBe(201);
    expect(res.body.credential.expiresAt).toBeDefined();
    expect(new Date(res.body.credential.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

// --- CRED-03: Credential list scoping ---------------------------------------

describeWithDb('CRED-03: Credential list scoping', () => {
  it('SUPER_ADMIN sees all credentials', async () => {
    const admin = await createSuperAdmin();
    const member = await createTestUser({ email: 'list-member@test.com' });
    await createTestCredential(admin.id);
    await createTestCredential(member.id);
    const token = await getAuthToken(admin);

    const res = await request(app)
      .get('/api/credentials')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.credentials.length).toBeGreaterThanOrEqual(2);
  });

  it('MEMBER sees only credentials they have access to', async () => {
    const admin = await createSuperAdmin();
    const member = await createTestUser({ email: 'scoped-member@test.com' });
    const cred1 = await createTestCredential(admin.id);
    await createTestCredential(admin.id); // no access for member
    await grantAccess(cred1.id, member.id, 'VIEW');
    const token = await getAuthToken(member);

    const res = await request(app)
      .get('/api/credentials')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.credentials.length).toBe(1);
    expect(res.body.credentials[0].id).toBe(cred1.id);
  });

  it('list response never includes encryptedValue or secret', async () => {
    const admin = await createSuperAdmin();
    await createTestCredential(admin.id);
    const token = await getAuthToken(admin);

    const res = await request(app)
      .get('/api/credentials')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    for (const cred of res.body.credentials) {
      expect(cred).not.toHaveProperty('encryptedValue');
      expect(cred).not.toHaveProperty('iv');
      expect(cred).not.toHaveProperty('authTag');
      expect(cred).not.toHaveProperty('keyVersion');
      expect(cred).not.toHaveProperty('secret');
    }
  });
});

// --- CRED-05: Get single credential with ACL enforcement --------------------

describeWithDb('CRED-05: Get single credential with ACL enforcement', () => {
  it('user with VIEW access can get credential (200)', async () => {
    const admin = await createSuperAdmin();
    const member = await createTestUser({ email: 'get-view@test.com' });
    const cred = await createTestCredential(admin.id);
    await grantAccess(cred.id, member.id, 'VIEW');
    const token = await getAuthToken(member);

    const res = await request(app)
      .get(`/api/credentials/${cred.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.credential.id).toBe(cred.id);
  });

  it('user without ACL entry gets 403', async () => {
    const admin = await createSuperAdmin();
    const member = await createTestUser({ email: 'no-acl@test.com' });
    const cred = await createTestCredential(admin.id);
    const token = await getAuthToken(member);

    const res = await request(app)
      .get(`/api/credentials/${cred.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('get returns 404 for non-existent ID', async () => {
    const admin = await createSuperAdmin();
    const token = await getAuthToken(admin);

    const res = await request(app)
      .get('/api/credentials/nonexistent-id')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('get response never includes encryptedValue', async () => {
    const admin = await createSuperAdmin();
    const cred = await createTestCredential(admin.id);
    const token = await getAuthToken(admin);

    const res = await request(app)
      .get(`/api/credentials/${cred.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.credential).not.toHaveProperty('encryptedValue');
    expect(res.body.credential).not.toHaveProperty('iv');
    expect(res.body.credential).not.toHaveProperty('authTag');
  });
});

// --- CRED-05: Update credential with ACL enforcement ------------------------

describeWithDb('CRED-05: Update credential with ACL enforcement', () => {
  it('EDIT permission can update credential fields (200)', async () => {
    const admin = await createSuperAdmin();
    const member = await createTestUser({ email: 'edit-update@test.com' });
    const cred = await createTestCredential(admin.id);
    await grantAccess(cred.id, member.id, 'EDIT');
    const token = await getAuthToken(member);

    const res = await request(app)
      .patch(`/api/credentials/${cred.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.credential.friendlyName).toBe('Updated Name');
  });

  it('VIEW-only permission cannot update (403)', async () => {
    const admin = await createSuperAdmin();
    const member = await createTestUser({ email: 'view-update@test.com' });
    const cred = await createTestCredential(admin.id);
    await grantAccess(cred.id, member.id, 'VIEW');
    const token = await getAuthToken(member);

    const res = await request(app)
      .patch(`/api/credentials/${cred.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Should Fail' });

    expect(res.status).toBe(403);
  });

  it('update with new secret re-encrypts (DB check)', async () => {
    const admin = await createSuperAdmin();
    const member = await createTestUser({ email: 'reencrypt@test.com' });
    const cred = await createTestCredential(admin.id, { secret: 'old-secret' });
    const oldRaw = await prisma.credential.findFirst({ where: { id: cred.id } });
    await grantAccess(cred.id, member.id, 'EDIT');
    const token = await getAuthToken(member);

    const res = await request(app)
      .patch(`/api/credentials/${cred.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ secret: 'new-secret' });

    expect(res.status).toBe(200);
    const newRaw = await prisma.credential.findFirst({ where: { id: cred.id } });
    expect(newRaw!.encryptedValue).not.toBe('new-secret');
    // Different IV means different ciphertext
    expect(newRaw!.encryptedValue).not.toBe(oldRaw!.encryptedValue);
  });

  it('update without secret leaves encryption intact', async () => {
    const admin = await createSuperAdmin();
    const cred = await createTestCredential(admin.id, { secret: 'keep-me' });
    const oldRaw = await prisma.credential.findFirst({ where: { id: cred.id } });
    const token = await getAuthToken(admin);

    const res = await request(app)
      .patch(`/api/credentials/${cred.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'New Name Only' });

    expect(res.status).toBe(200);
    const newRaw = await prisma.credential.findFirst({ where: { id: cred.id } });
    expect(newRaw!.encryptedValue).toBe(oldRaw!.encryptedValue);
    expect(newRaw!.iv).toBe(oldRaw!.iv);
  });

  it('update returns 404 for non-existent ID', async () => {
    const admin = await createSuperAdmin();
    const token = await getAuthToken(admin);

    const res = await request(app)
      .patch('/api/credentials/nonexistent-id')
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Nope' });

    expect(res.status).toBe(404);
  });
});

// --- CRED-05: Delete credential with ACL enforcement ------------------------

describeWithDb('CRED-05: Delete credential with ACL enforcement', () => {
  it('MANAGE permission can delete credential (204)', async () => {
    const admin = await createSuperAdmin();
    const member = await createTestUser({ email: 'manage-delete@test.com' });
    const cred = await createTestCredential(admin.id);
    await grantAccess(cred.id, member.id, 'MANAGE');
    const token = await getAuthToken(member);

    const res = await request(app)
      .delete(`/api/credentials/${cred.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);

    // Verify soft-deleted
    const raw = await prisma.credential.findFirst({
      where: { id: cred.id, deletedAt: null },
    });
    expect(raw).toBeNull();
  });

  it('EDIT permission cannot delete (403)', async () => {
    const admin = await createSuperAdmin();
    const member = await createTestUser({ email: 'edit-delete@test.com' });
    const cred = await createTestCredential(admin.id);
    await grantAccess(cred.id, member.id, 'EDIT');
    const token = await getAuthToken(member);

    const res = await request(app)
      .delete(`/api/credentials/${cred.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('deleted credential no longer visible in list or get', async () => {
    const admin = await createSuperAdmin();
    const cred = await createTestCredential(admin.id);
    const token = await getAuthToken(admin);

    // Delete it
    await request(app)
      .delete(`/api/credentials/${cred.id}`)
      .set('Authorization', `Bearer ${token}`);

    // GET single should 404
    const getRes = await request(app)
      .get(`/api/credentials/${cred.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(404);

    // List should not include it
    const listRes = await request(app)
      .get('/api/credentials')
      .set('Authorization', `Bearer ${token}`);
    const ids = listRes.body.credentials.map((c: any) => c.id);
    expect(ids).not.toContain(cred.id);
  });
});

// --- CRED-04: Reveal with rate limiting and audit log -----------------------

describeWithDb('CRED-04: Reveal with rate limiting and audit log', () => {
  it('reveal returns plaintext secret (200)', async () => {
    const admin = await createSuperAdmin();
    const token = await getAuthToken(admin);

    // Create via API so the secret goes through encrypt path
    const createRes = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Reveal Me', secret: 'test-secret-123' });

    const credId = createRes.body.credential.id;

    const res = await request(app)
      .post(`/api/credentials/${credId}/reveal`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.secret).toBe('test-secret-123');
  });

  it('reveal is audit-logged BEFORE returning', async () => {
    const admin = await createSuperAdmin();
    const token = await getAuthToken(admin);

    const createRes = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Audit Me', secret: 'audit-secret' });

    const credId = createRes.body.credential.id;

    await request(app)
      .post(`/api/credentials/${credId}/reveal`)
      .set('Authorization', `Bearer ${token}`);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: credId, action: 'REVEAL' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry!.userId).toBe(admin.id);
    expect(auditEntry!.targetType).toBe('CREDENTIAL');
  });

  it('reveal without ACL returns 403', async () => {
    const admin = await createSuperAdmin();
    const member = await createTestUser({ email: 'reveal-noacl@test.com' });
    const cred = await createTestCredential(admin.id);
    const token = await getAuthToken(member);

    const res = await request(app)
      .post(`/api/credentials/${cred.id}/reveal`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('reveal returns 404 for non-existent ID', async () => {
    const admin = await createSuperAdmin();
    const token = await getAuthToken(admin);

    const res = await request(app)
      .post('/api/credentials/nonexistent-id/reveal')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('reveal rate limit returns 429 after 10 requests', async () => {
    const admin = await createSuperAdmin();
    const token = await getAuthToken(admin);

    const createRes = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Rate Limit Me', secret: 'rate-limit-secret' });

    const credId = createRes.body.credential.id;

    // Send 10 requests (should all succeed)
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post(`/api/credentials/${credId}/reveal`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    }

    // 11th request should be rate limited
    const res = await request(app)
      .post(`/api/credentials/${credId}/reveal`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(429);
  });
});
