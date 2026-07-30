import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
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
  await prisma.auditLog.deleteMany();
  await prisma.assetAccess.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  if (!canConnect) return;
  await prisma.auditLog.deleteMany();
  await prisma.assetAccess.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

// --- Helpers ----------------------------------------------------------------

let userCounter = 0;

async function createTestUser(
  role: Role = 'MEMBER',
  overrides?: Partial<{ email: string; name: string }>,
) {
  userCounter++;
  return prisma.user.create({
    data: {
      email: overrides?.email ?? `assetuser${userCounter}@test.com`,
      name: overrides?.name ?? `Asset Test User ${userCounter}`,
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

let assetCounter = 0;

async function createTestAsset(
  createdById: string,
  overrides?: Partial<{
    assetId: string;
    name: string;
    category: string;
    status: string;
    location: string;
    notes: string;
  }>,
) {
  assetCounter++;
  const assetId = overrides?.assetId ?? `ASSET-TEST-${assetCounter}-${Date.now()}`;
  const asset = await prisma.asset.create({
    data: {
      assetId,
      name: overrides?.name ?? `Test Asset ${assetCounter}`,
      category: (overrides?.category as any) ?? 'HARDWARE',
      status: (overrides?.status as any) ?? 'ACTIVE',
      location: overrides?.location,
      notes: overrides?.notes,
      createdById,
    },
  });
  return asset;
}

async function grantAccess(assetId: string, userId: string, permission = 'VIEW') {
  return prisma.assetAccess.create({
    data: { assetId, userId, permission: permission as any },
  });
}

// --- ASSET-01: Create -------------------------------------------------------

describeWithDb('ASSET-01: Asset CRUD - Create', () => {
  it('POST /api/assets with all fields returns 201', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        assetId: 'ASSET-FULL-001',
        name: 'Full Asset',
        category: 'HARDWARE',
        status: 'ACTIVE',
        location: 'Office A',
        notes: 'Test notes',
      });

    expect(res.status).toBe(201);
    expect(res.body.asset).toHaveProperty('id');
    expect(res.body.asset.assetId).toBe('ASSET-FULL-001');
    expect(res.body.asset.name).toBe('Full Asset');
    expect(res.body.asset.category).toBe('HARDWARE');
    expect(res.body.asset.status).toBe('ACTIVE');
    expect(res.body.asset.location).toBe('Office A');
    expect(res.body.asset.notes).toBe('Test notes');
  });

  it('POST /api/assets with only required fields returns 201, status defaults to ACTIVE', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);

    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        assetId: 'ASSET-MIN-001',
        name: 'Minimal Asset',
        category: 'SOFTWARE',
      });

    expect(res.status).toBe(201);
    expect(res.body.asset.status).toBe('ACTIVE');
    expect(res.body.asset.location).toBeNull();
    expect(res.body.asset.notes).toBeNull();
  });

  it('POST /api/assets with duplicate assetId returns 409', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ assetId: 'ASSET-DUP-001', name: 'First', category: 'HARDWARE' });

    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ assetId: 'ASSET-DUP-001', name: 'Second', category: 'SOFTWARE' });

    expect(res.status).toBe(409);
  });

  it('POST /api/assets with missing required fields returns 400', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No AssetId' });

    expect(res.status).toBe(400);
  });

  it('POST /api/assets without auth returns 401', async () => {
    const res = await request(app)
      .post('/api/assets')
      .send({ assetId: 'ASSET-NOAUTH-001', name: 'No Auth', category: 'HARDWARE' });

    expect(res.status).toBe(401);
  });

  it('creator is auto-granted MANAGE access', async () => {
    const member = await createTestUser('MEMBER');
    const token = await getAuthToken(member);

    const createRes = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ assetId: 'ASSET-ACCESS-001', name: 'Access Test', category: 'DIGITAL' });

    expect(createRes.status).toBe(201);

    // Verify by fetching with the same user (needs VIEW access which MANAGE includes)
    const getRes = await request(app)
      .get(`/api/assets/${createRes.body.asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.asset.id).toBe(createRes.body.asset.id);
  });
});

// --- ASSET-02: Category enforcement -----------------------------------------

describeWithDb('ASSET-02: Category enforcement', () => {
  it.each(['HARDWARE', 'SOFTWARE', 'DIGITAL', 'INTANGIBLE'])(
    'POST /api/assets with category %s returns 201',
    async (category) => {
      const admin = await createTestUser('SUPER_ADMIN');
      const token = await getAuthToken(admin);

      const res = await request(app)
        .post('/api/assets')
        .set('Authorization', `Bearer ${token}`)
        .send({
          assetId: `ASSET-CAT-${category}-${Date.now()}`,
          name: `Cat ${category}`,
          category,
        });

      expect(res.status).toBe(201);
      expect(res.body.asset.category).toBe(category);
    },
  );

  it('POST /api/assets with invalid category returns 400', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ assetId: 'ASSET-BADCAT-001', name: 'Bad Cat', category: 'FURNITURE' });

    expect(res.status).toBe(400);
  });
});

// --- ASSET-04: Access-scoped CRUD -------------------------------------------

describeWithDb('ASSET-04: Access-scoped operations', () => {
  it('GET /api/assets returns only assets user has access to (non-privileged)', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const member = await createTestUser('MEMBER');
    const asset1 = await createTestAsset(admin.id);
    await createTestAsset(admin.id); // no access for member
    await grantAccess(asset1.id, member.id, 'VIEW');
    const token = await getAuthToken(member);

    const res = await request(app)
      .get('/api/assets')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.assets.length).toBe(1);
    expect(res.body.assets[0].id).toBe(asset1.id);
  });

  it('GET /api/assets returns all assets for SUPER_ADMIN', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const member = await createTestUser('MEMBER');
    await createTestAsset(admin.id);
    await createTestAsset(member.id);
    const token = await getAuthToken(admin);

    const res = await request(app)
      .get('/api/assets')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.assets.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/assets returns all assets for MANAGER', async () => {
    const manager = await createTestUser('MANAGER');
    const member = await createTestUser('MEMBER');
    await createTestAsset(manager.id);
    await createTestAsset(member.id);
    const token = await getAuthToken(manager);

    const res = await request(app)
      .get('/api/assets')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.assets.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/assets/:id with access returns 200', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const member = await createTestUser('MEMBER');
    const asset = await createTestAsset(admin.id);
    await grantAccess(asset.id, member.id, 'VIEW');
    const token = await getAuthToken(member);

    const res = await request(app)
      .get(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.asset.id).toBe(asset.id);
  });

  it('GET /api/assets/:id without access returns 403', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const member = await createTestUser('MEMBER');
    const asset = await createTestAsset(admin.id);
    const token = await getAuthToken(member);

    const res = await request(app)
      .get(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('PATCH /api/assets/:id with EDIT access returns 200', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const member = await createTestUser('MEMBER');
    const asset = await createTestAsset(admin.id);
    await grantAccess(asset.id, member.id, 'EDIT');
    const token = await getAuthToken(member);

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.asset.name).toBe('Updated Name');
  });

  it('PATCH /api/assets/:id with VIEW-only access returns 403', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const member = await createTestUser('MEMBER');
    const asset = await createTestAsset(admin.id);
    await grantAccess(asset.id, member.id, 'VIEW');
    const token = await getAuthToken(member);

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Should Fail' });

    expect(res.status).toBe(403);
  });

  it('DELETE /api/assets/:id with MANAGE access returns 204', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const member = await createTestUser('MEMBER');
    const asset = await createTestAsset(admin.id);
    await grantAccess(asset.id, member.id, 'MANAGE');
    const token = await getAuthToken(member);

    const res = await request(app)
      .delete(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
  });

  it('DELETE /api/assets/:id without MANAGE access returns 403', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const member = await createTestUser('MEMBER');
    const asset = await createTestAsset(admin.id);
    await grantAccess(asset.id, member.id, 'EDIT');
    const token = await getAuthToken(member);

    const res = await request(app)
      .delete(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('soft-deleted asset excluded from GET list and GET by id', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const asset = await createTestAsset(admin.id);
    const token = await getAuthToken(admin);

    // Delete it
    await request(app)
      .delete(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    // GET single should 404
    const getRes = await request(app)
      .get(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(404);

    // List should not include it
    const listRes = await request(app)
      .get('/api/assets')
      .set('Authorization', `Bearer ${token}`);
    const ids = listRes.body.assets.map((a: any) => a.id);
    expect(ids).not.toContain(asset.id);
  });

  it('assetId cannot be changed via update (field is ignored)', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const createRes = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ assetId: 'ASSET-IMMUTABLE-001', name: 'Immutable ID', category: 'HARDWARE' });

    expect(createRes.status).toBe(201);
    const assetDbId = createRes.body.asset.id;

    const updateRes = await request(app)
      .patch(`/api/assets/${assetDbId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetId: 'ASSET-CHANGED-001', name: 'Updated Name' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.asset.assetId).toBe('ASSET-IMMUTABLE-001');
  });
});

// --- ASSET-03: Status state machine -----------------------------------------

describeWithDb('ASSET-03: Status state machine', () => {
  // Valid transitions
  it('ACTIVE -> MAINTENANCE succeeds (200)', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);
    const asset = await createTestAsset(user.id, { status: 'ACTIVE' });
    await grantAccess(asset.id, user.id, 'EDIT');

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'MAINTENANCE' });

    expect(res.status).toBe(200);
    expect(res.body.asset.status).toBe('MAINTENANCE');
  });

  it('ACTIVE -> RETIRED succeeds (200)', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);
    const asset = await createTestAsset(user.id, { status: 'ACTIVE' });
    await grantAccess(asset.id, user.id, 'EDIT');

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'RETIRED' });

    expect(res.status).toBe(200);
    expect(res.body.asset.status).toBe('RETIRED');
  });

  it('ACTIVE -> LOST succeeds (200)', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);
    const asset = await createTestAsset(user.id, { status: 'ACTIVE' });
    await grantAccess(asset.id, user.id, 'EDIT');

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'LOST' });

    expect(res.status).toBe(200);
    expect(res.body.asset.status).toBe('LOST');
  });

  it('MAINTENANCE -> ACTIVE succeeds (200)', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);
    const asset = await createTestAsset(user.id, { status: 'MAINTENANCE' });
    await grantAccess(asset.id, user.id, 'EDIT');

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(200);
    expect(res.body.asset.status).toBe('ACTIVE');
  });

  it('LOST -> ACTIVE succeeds (200)', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);
    const asset = await createTestAsset(user.id, { status: 'LOST' });
    await grantAccess(asset.id, user.id, 'EDIT');

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(200);
    expect(res.body.asset.status).toBe('ACTIVE');
  });

  it('LOST -> RETIRED succeeds (200)', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);
    const asset = await createTestAsset(user.id, { status: 'LOST' });
    await grantAccess(asset.id, user.id, 'EDIT');

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'RETIRED' });

    expect(res.status).toBe(200);
    expect(res.body.asset.status).toBe('RETIRED');
  });

  // Invalid transitions
  it('MAINTENANCE -> RETIRED returns 400', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);
    const asset = await createTestAsset(user.id, { status: 'MAINTENANCE' });
    await grantAccess(asset.id, user.id, 'EDIT');

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'RETIRED' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot transition');
  });

  it('MAINTENANCE -> LOST returns 400', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);
    const asset = await createTestAsset(user.id, { status: 'MAINTENANCE' });
    await grantAccess(asset.id, user.id, 'EDIT');

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'LOST' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot transition');
  });

  it('RETIRED -> ACTIVE returns 400 for non-admin', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);
    const asset = await createTestAsset(user.id, { status: 'RETIRED' });
    await grantAccess(asset.id, user.id, 'EDIT');

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot transition');
  });

  it('RETIRED -> MAINTENANCE returns 400 for non-admin', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);
    const asset = await createTestAsset(user.id, { status: 'RETIRED' });
    await grantAccess(asset.id, user.id, 'EDIT');

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'MAINTENANCE' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot transition');
  });

  // Admin override
  it('SUPER_ADMIN can transition RETIRED -> ACTIVE (200)', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);
    const asset = await createTestAsset(admin.id, { status: 'RETIRED' });

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(200);
    expect(res.body.asset.status).toBe('ACTIVE');
  });

  it('SUPER_ADMIN can transition RETIRED -> MAINTENANCE (200)', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);
    const asset = await createTestAsset(admin.id, { status: 'RETIRED' });

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'MAINTENANCE' });

    expect(res.status).toBe(200);
    expect(res.body.asset.status).toBe('MAINTENANCE');
  });

  // Edge cases
  it('same status (ACTIVE -> ACTIVE) is a no-op (200)', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);
    const asset = await createTestAsset(user.id, { status: 'ACTIVE' });
    await grantAccess(asset.id, user.id, 'EDIT');

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(200);
    expect(res.body.asset.status).toBe('ACTIVE');
  });

  it('update without status field does not trigger state machine validation (200)', async () => {
    const user = await createTestUser('MEMBER');
    const token = await getAuthToken(user);
    const asset = await createTestAsset(user.id, { status: 'RETIRED' });
    await grantAccess(asset.id, user.id, 'EDIT');

    const res = await request(app)
      .patch(`/api/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Just a name change' });

    expect(res.status).toBe(200);
    expect(res.body.asset.name).toBe('Just a name change');
    expect(res.body.asset.status).toBe('RETIRED');
  });
});
