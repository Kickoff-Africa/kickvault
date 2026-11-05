import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app.js';
import { prisma, basePrisma } from '../../config/database.js';
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
  // TRUNCATE bypasses both $extends immutability guard and DB trigger
  await basePrisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs" CASCADE');
  await prisma.credentialAccess.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.assetAccess.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  if (!canConnect) return;
  await basePrisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs" CASCADE');
  await prisma.credentialAccess.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.assetAccess.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

// --- Helpers ----------------------------------------------------------------

let userCounter = 0;

async function createTestUser(role: Role = 'MEMBER') {
  userCounter++;
  return prisma.user.create({
    data: {
      email: `dashuser${userCounter}@test.com`,
      name: `Dash Test User ${userCounter}`,
      passwordHash: testPasswordHash,
      role,
      isActive: true,
      mustChangePassword: false,
    },
  });
}

async function getAuthToken(user: { id: string; role: Role }): Promise<string> {
  return signAccessToken({
    userId: user.id,
    role: user.role,
    sessionId: 'test-session-id',
  });
}

let credCounter = 0;
let assetCounter = 0;

async function createTestCredential(
  createdById: string,
  overrides?: Partial<{ friendlyName: string; expiresAt: Date | null }>,
) {
  credCounter++;
  const secret = 'test-secret';
  const encrypted = encrypt(secret);
  return basePrisma.credential.create({
    data: {
      friendlyName: overrides?.friendlyName ?? `Dash Cred ${credCounter}`,
      systemHost: 'test.example.com',
      username: 'testuser',
      encryptedValue: encrypted.encryptedValue,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      createdById,
      ...(overrides?.expiresAt !== undefined && { expiresAt: overrides.expiresAt }),
    },
  });
}

async function createTestAsset(createdById: string) {
  assetCounter++;
  return basePrisma.asset.create({
    data: {
      assetId: `DASH-ASSET-${assetCounter}-${Date.now()}`,
      name: `Dash Asset ${assetCounter}`,
      categoryId: 'cat_hardware',
      status: 'ACTIVE',
      createdById,
    },
  });
}

// --- Authorization ----------------------------------------------------------

describeWithDb('DASH Authorization: /api/dashboard/stats', () => {
  it('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(401);
  });

  it('MEMBER request returns 403', async () => {
    const member = await createTestUser('MEMBER');
    const token = await getAuthToken(member);

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('MANAGER request returns 200', async () => {
    const manager = await createTestUser('MANAGER');
    const token = await getAuthToken(manager);

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('SUPER_ADMIN request returns 200', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

// --- DASH-01: Stats counts --------------------------------------------------

describeWithDb('DASH-01: Dashboard stats counts', () => {
  it('returns 200 with required keys: totalAssets, totalCredentials, expiringCredentials, recentActivity', async () => {
    const manager = await createTestUser('MANAGER');
    const token = await getAuthToken(manager);

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalAssets');
    expect(res.body).toHaveProperty('totalCredentials');
    expect(res.body).toHaveProperty('expiringCredentials');
    expect(res.body).toHaveProperty('recentActivity');
  });

  it('totalAssets and totalCredentials reflect actual created data', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    // Create 2 assets and 3 credentials
    await createTestAsset(admin.id);
    await createTestAsset(admin.id);
    await createTestCredential(admin.id);
    await createTestCredential(admin.id);
    await createTestCredential(admin.id);

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalAssets).toBe(2);
    expect(res.body.totalCredentials).toBe(3);
  });

  it('expiringCredentials counts only credentials with expiresAt between now and threshold', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const now = new Date();

    // Expires in 10 days — within default 30-day threshold, should be counted
    const in10Days = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    await createTestCredential(admin.id, { expiresAt: in10Days });

    // Expires in 60 days — outside threshold, should NOT be counted
    const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    await createTestCredential(admin.id, { expiresAt: in60Days });

    // Already expired yesterday — should NOT be counted (gte: now excludes past)
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await createTestCredential(admin.id, { expiresAt: yesterday });

    // No expiresAt — should NOT be counted
    await createTestCredential(admin.id, { expiresAt: null });

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.expiringCredentials).toBe(1);
  });

  it('custom ?expiring_threshold=7 narrows the expiring window', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const now = new Date();

    // Expires in 5 days — within 7-day threshold
    const in5Days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    await createTestCredential(admin.id, { expiresAt: in5Days });

    // Expires in 10 days — outside 7-day threshold but within default 30-day
    const in10Days = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    await createTestCredential(admin.id, { expiresAt: in10Days });

    const res = await request(app)
      .get('/api/dashboard/stats?expiring_threshold=7')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.expiringCredentials).toBe(1);
  });
});

// --- DASH-02: Recent activity feed ------------------------------------------

describeWithDb('DASH-02: Dashboard recent activity', () => {
  it('recentActivity is an array of at most 10 items', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    // Create 12 audit log entries
    for (let i = 0; i < 12; i++) {
      await basePrisma.auditLog.create({
        data: {
          action: 'CREATE',
          targetType: 'CREDENTIAL',
          targetId: `cred-dash-${i}`,
          userId: admin.id,
        },
      });
    }

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recentActivity)).toBe(true);
    expect(res.body.recentActivity.length).toBeLessThanOrEqual(10);
    expect(res.body.recentActivity.length).toBe(10);
  });

  it('each activity item has id, action, createdAt, and user with id, email, name', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    await basePrisma.auditLog.create({
      data: {
        action: 'CREATE',
        targetType: 'ASSET',
        targetId: 'some-asset-id',
        userId: admin.id,
      },
    });

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.recentActivity.length).toBeGreaterThanOrEqual(1);

    const item = res.body.recentActivity[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('action');
    expect(item).toHaveProperty('createdAt');
    expect(item).toHaveProperty('user');
    expect(item.user).toHaveProperty('id');
    expect(item.user).toHaveProperty('email');
    expect(item.user).toHaveProperty('name');
  });

  it('recentActivity is ordered newest-first', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    // Create 3 entries
    for (let i = 0; i < 3; i++) {
      await basePrisma.auditLog.create({
        data: {
          action: 'CREATE',
          targetType: 'CREDENTIAL',
          targetId: `order-cred-${i}`,
          userId: admin.id,
        },
      });
    }

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const items = res.body.recentActivity as Array<{ createdAt: string }>;
    for (let i = 1; i < items.length; i++) {
      expect(new Date(items[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(items[i].createdAt).getTime(),
      );
    }
  });
});
