import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app.js';
import { prisma } from '../../config/database.js';
import { hashPassword } from '../../services/password.service.js';
import { signAccessToken } from '../../services/token.service.js';
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
  await prisma.assetAccess.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  if (!canConnect) return;
  await prisma.assetAccess.deleteMany();
  await prisma.asset.deleteMany();
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
      email: overrides?.email ?? `assetuser${userCounter}@test.com`,
      name: overrides?.name ?? `Asset Test User ${userCounter}`,
      passwordHash: testPasswordHash,
      role: overrides?.role ?? 'MEMBER',
      isActive: overrides?.isActive ?? true,
      mustChangePassword: false,
    },
  });
}

async function createSuperAdmin(email = 'assetadmin@test.com') {
  return createTestUser({ role: 'SUPER_ADMIN', email });
}

async function getAuthToken(user: { id: string; role: Role }): Promise<string> {
  return signAccessToken({
    userId: user.id,
    role: user.role,
    sessionId: 'test-session-id',
  });
}

let assetCounter = 0;

async function createTestAsset(createdById: string) {
  assetCounter++;
  return prisma.asset.create({
    data: {
      assetId: `ASSET-${assetCounter}-${Date.now()}`,
      name: `Test Asset ${assetCounter}`,
      categoryId: 'cat_hardware',
      status: 'ACTIVE',
      createdById,
    },
  });
}

// --- ACL-02/ACL-04: Asset access management ---------------------------------

describeWithDb('ACL-02/ACL-04: Asset access management', () => {
  it('SUPER_ADMIN can grant VIEW access to an asset (201)', async () => {
    const admin = await createSuperAdmin();
    const targetUser = await createTestUser({ email: 'target1@test.com' });
    const asset = await createTestAsset(admin.id);
    const token = await getAuthToken(admin);

    const res = await request(app)
      .post(`/api/assets/${asset.id}/access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: targetUser.id, permission: 'VIEW' });

    expect(res.status).toBe(201);
    expect(res.body.access).toHaveProperty('userId', targetUser.id);
    expect(res.body.access).toHaveProperty('assetId', asset.id);
    expect(res.body.access).toHaveProperty('permission', 'VIEW');
  });

  it('MANAGER can grant access to an asset (201)', async () => {
    const admin = await createSuperAdmin();
    const manager = await createTestUser({ role: 'MANAGER', email: 'mgr@test.com' });
    const targetUser = await createTestUser({ email: 'target2@test.com' });
    const asset = await createTestAsset(admin.id);
    const token = await getAuthToken(manager);

    const res = await request(app)
      .post(`/api/assets/${asset.id}/access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: targetUser.id, permission: 'VIEW' });

    expect(res.status).toBe(201);
  });

  it('granting again with different permission updates it (upsert)', async () => {
    const admin = await createSuperAdmin();
    const targetUser = await createTestUser({ email: 'target3@test.com' });
    const asset = await createTestAsset(admin.id);
    const token = await getAuthToken(admin);

    const res1 = await request(app)
      .post(`/api/assets/${asset.id}/access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: targetUser.id, permission: 'VIEW' });

    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post(`/api/assets/${asset.id}/access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: targetUser.id, permission: 'EDIT' });

    expect(res2.status).toBe(201);
    expect(res2.body.access.permission).toBe('EDIT');

    const count = await prisma.assetAccess.count({
      where: { assetId: asset.id, userId: targetUser.id },
    });
    expect(count).toBe(1);
  });

  it('default permission is VIEW when not specified', async () => {
    const admin = await createSuperAdmin();
    const targetUser = await createTestUser({ email: 'target4@test.com' });
    const asset = await createTestAsset(admin.id);
    const token = await getAuthToken(admin);

    const res = await request(app)
      .post(`/api/assets/${asset.id}/access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: targetUser.id });

    expect(res.status).toBe(201);
    expect(res.body.access.permission).toBe('VIEW');
  });

  it('list returns entries with user email and name (200)', async () => {
    const admin = await createSuperAdmin();
    const user1 = await createTestUser({ email: 'list1@test.com', name: 'List User 1' });
    const user2 = await createTestUser({ email: 'list2@test.com', name: 'List User 2' });
    const asset = await createTestAsset(admin.id);
    const token = await getAuthToken(admin);

    await request(app)
      .post(`/api/assets/${asset.id}/access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: user1.id, permission: 'VIEW' });

    await request(app)
      .post(`/api/assets/${asset.id}/access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: user2.id, permission: 'EDIT' });

    const res = await request(app)
      .get(`/api/assets/${asset.id}/access`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.access).toHaveLength(2);
    for (const entry of res.body.access) {
      expect(entry.user).toHaveProperty('email');
      expect(entry.user).toHaveProperty('name');
    }
  });

  it('revoke access returns 204', async () => {
    const admin = await createSuperAdmin();
    const targetUser = await createTestUser({ email: 'revoke1@test.com' });
    const asset = await createTestAsset(admin.id);
    const token = await getAuthToken(admin);

    await request(app)
      .post(`/api/assets/${asset.id}/access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: targetUser.id, permission: 'VIEW' });

    const res = await request(app)
      .delete(`/api/assets/${asset.id}/access/${targetUser.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);

    const count = await prisma.assetAccess.count({
      where: { assetId: asset.id },
    });
    expect(count).toBe(0);
  });

  it('MEMBER cannot grant access (403)', async () => {
    const admin = await createSuperAdmin();
    const member = await createTestUser({ role: 'MEMBER', email: 'member@test.com' });
    const targetUser = await createTestUser({ email: 'target5@test.com' });
    const asset = await createTestAsset(admin.id);
    const token = await getAuthToken(member);

    const res = await request(app)
      .post(`/api/assets/${asset.id}/access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: targetUser.id, permission: 'VIEW' });

    expect(res.status).toBe(403);
  });

  it('VIEWER cannot grant access (403)', async () => {
    const admin = await createSuperAdmin();
    const viewer = await createTestUser({ role: 'VIEWER', email: 'viewer@test.com' });
    const targetUser = await createTestUser({ email: 'target6@test.com' });
    const asset = await createTestAsset(admin.id);
    const token = await getAuthToken(viewer);

    const res = await request(app)
      .post(`/api/assets/${asset.id}/access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: targetUser.id, permission: 'VIEW' });

    expect(res.status).toBe(403);
  });

  it('grant to non-existent asset returns 404', async () => {
    const admin = await createSuperAdmin();
    const targetUser = await createTestUser({ email: 'target7@test.com' });
    const token = await getAuthToken(admin);

    const res = await request(app)
      .post('/api/assets/nonexistent-id/access')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: targetUser.id, permission: 'VIEW' });

    expect(res.status).toBe(404);
  });

  it('grant to non-existent user returns 404', async () => {
    const admin = await createSuperAdmin();
    const asset = await createTestAsset(admin.id);
    const token = await getAuthToken(admin);

    const res = await request(app)
      .post(`/api/assets/${asset.id}/access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'nonexistent-id', permission: 'VIEW' });

    expect(res.status).toBe(404);
  });

  it('revoke non-existent access entry returns 404', async () => {
    const admin = await createSuperAdmin();
    const targetUser = await createTestUser({ email: 'target8@test.com' });
    const asset = await createTestAsset(admin.id);
    const token = await getAuthToken(admin);

    const res = await request(app)
      .delete(`/api/assets/${asset.id}/access/${targetUser.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('list access on non-existent asset returns 404', async () => {
    const admin = await createSuperAdmin();
    const token = await getAuthToken(admin);

    const res = await request(app)
      .get('/api/assets/nonexistent-id/access')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
