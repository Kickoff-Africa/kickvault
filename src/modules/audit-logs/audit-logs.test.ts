import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app.js';
import { prisma, basePrisma } from '../../config/database.js';
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

async function createTestUser(role: Role = 'MEMBER', overrides?: Partial<{ email: string; name: string }>) {
  userCounter++;
  return prisma.user.create({
    data: {
      email: overrides?.email ?? `audituser${userCounter}@test.com`,
      name: overrides?.name ?? `Audit Test User ${userCounter}`,
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

// --- AUDIT-02/03: Immutability (application layer) --------------------------

describeWithDb('AUDIT-02/03: AuditLog immutability at application layer', () => {
  it('prisma.auditLog.update() throws with "immutable" message', async () => {
    const user = await createTestUser('SUPER_ADMIN');
    const log = await basePrisma.auditLog.create({
      data: {
        action: 'CREATE',
        targetType: 'CREDENTIAL',
        targetId: 'some-id',
        userId: user.id,
      },
    });

    await expect(
      prisma.auditLog.update({
        where: { id: log.id },
        data: { action: 'UPDATE' },
      }),
    ).rejects.toThrow('immutable');
  });

  it('prisma.auditLog.updateMany() throws with "immutable" message', async () => {
    const user = await createTestUser('SUPER_ADMIN');
    await basePrisma.auditLog.create({
      data: {
        action: 'CREATE',
        targetType: 'CREDENTIAL',
        targetId: 'some-id',
        userId: user.id,
      },
    });

    await expect(
      prisma.auditLog.updateMany({
        where: { action: 'CREATE' },
        data: { action: 'UPDATE' },
      }),
    ).rejects.toThrow('immutable');
  });

  it('prisma.auditLog.delete() throws with "immutable" message', async () => {
    const user = await createTestUser('SUPER_ADMIN');
    const log = await basePrisma.auditLog.create({
      data: {
        action: 'DELETE',
        targetType: 'CREDENTIAL',
        targetId: 'some-id',
        userId: user.id,
      },
    });

    await expect(
      prisma.auditLog.delete({ where: { id: log.id } }),
    ).rejects.toThrow('immutable');
  });

  it('prisma.auditLog.deleteMany() throws with "immutable" message', async () => {
    const user = await createTestUser('SUPER_ADMIN');
    await basePrisma.auditLog.create({
      data: {
        action: 'DELETE',
        targetType: 'CREDENTIAL',
        targetId: 'some-id',
        userId: user.id,
      },
    });

    await expect(
      prisma.auditLog.deleteMany({ where: { action: 'DELETE' } }),
    ).rejects.toThrow('immutable');
  });
});

// --- AUDIT-01: Auto-logging on credential CRUD/REVEAL -----------------------

describeWithDb('AUDIT-01: Auto-logging for credential operations', () => {
  it('creating a credential produces an audit log with action=CREATE, targetType=CREDENTIAL', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const res = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Auto-log create', secret: 'secret123' });

    expect(res.status).toBe(201);
    const credId = res.body.credential.id;

    const logs = await basePrisma.auditLog.findMany({
      where: { targetId: credId, action: 'CREATE' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].targetType).toBe('CREDENTIAL');
    expect(logs[0].userId).toBe(admin.id);
  });

  it('updating a credential produces an audit log with action=EDIT', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const createRes = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Auto-log update', secret: 'secret123' });

    expect(createRes.status).toBe(201);
    const credId = createRes.body.credential.id;

    // Clear logs so we only see the update log
    await basePrisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs" CASCADE');

    const updateRes = await request(app)
      .patch(`/api/credentials/${credId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Updated Name' });

    expect(updateRes.status).toBe(200);

    const logs = await basePrisma.auditLog.findMany({
      where: { targetId: credId, action: 'EDIT' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].targetType).toBe('CREDENTIAL');
    expect(logs[0].userId).toBe(admin.id);
  });

  it('deleting a credential produces an audit log with action=DELETE', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const createRes = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Auto-log delete', secret: 'secret123' });

    expect(createRes.status).toBe(201);
    const credId = createRes.body.credential.id;

    // Clear prior logs
    await basePrisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs" CASCADE');

    const deleteRes = await request(app)
      .delete(`/api/credentials/${credId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(deleteRes.status).toBe(204);

    const logs = await basePrisma.auditLog.findMany({
      where: { targetId: credId, action: 'DELETE' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].targetType).toBe('CREDENTIAL');
    expect(logs[0].userId).toBe(admin.id);
  });

  it('revealing a credential produces an audit log with action=REVEAL', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const createRes = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ friendlyName: 'Auto-log reveal', secret: 'reveal-secret' });

    expect(createRes.status).toBe(201);
    const credId = createRes.body.credential.id;

    // Clear prior logs
    await basePrisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs" CASCADE');

    const revealRes = await request(app)
      .post(`/api/credentials/${credId}/reveal`)
      .set('Authorization', `Bearer ${token}`);

    expect(revealRes.status).toBe(200);

    const logs = await basePrisma.auditLog.findMany({
      where: { targetId: credId, action: 'REVEAL' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].targetType).toBe('CREDENTIAL');
    expect(logs[0].userId).toBe(admin.id);
  });
});

// --- AUDIT-04: Cursor pagination --------------------------------------------

describeWithDb('AUDIT-04: Cursor pagination', () => {
  it('returns correct items, nextCursor, and hasMore on first page', async () => {
    const manager = await createTestUser('MANAGER');
    const token = await getAuthToken(manager);

    // Create 5 audit log entries directly
    for (let i = 0; i < 5; i++) {
      await basePrisma.auditLog.create({
        data: {
          action: 'CREATE',
          targetType: 'CREDENTIAL',
          targetId: `cred-${i}`,
          userId: manager.id,
        },
      });
    }

    const res = await request(app)
      .get('/api/audit-logs?limit=2')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.nextCursor).toBeDefined();
  });

  it('returns correct items when paginating with cursor', async () => {
    const manager = await createTestUser('MANAGER');
    const token = await getAuthToken(manager);

    for (let i = 0; i < 5; i++) {
      await basePrisma.auditLog.create({
        data: {
          action: 'CREATE',
          targetType: 'CREDENTIAL',
          targetId: `cred-${i}`,
          userId: manager.id,
        },
      });
    }

    // Get first page
    const page1 = await request(app)
      .get('/api/audit-logs?limit=2')
      .set('Authorization', `Bearer ${token}`);

    expect(page1.status).toBe(200);
    const cursor = page1.body.nextCursor;

    // Get second page
    const page2 = await request(app)
      .get(`/api/audit-logs?limit=2&cursor=${cursor}`)
      .set('Authorization', `Bearer ${token}`);

    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(2);

    // No overlap between pages
    const page1Ids = page1.body.items.map((i: any) => i.id);
    const page2Ids = page2.body.items.map((i: any) => i.id);
    const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('returns results newest-first (createdAt descending)', async () => {
    const manager = await createTestUser('MANAGER');
    const token = await getAuthToken(manager);

    // Create entries with small delay to ensure distinct timestamps
    for (let i = 0; i < 3; i++) {
      await basePrisma.auditLog.create({
        data: {
          action: 'CREATE',
          targetType: 'CREDENTIAL',
          targetId: `cred-order-${i}`,
          userId: manager.id,
        },
      });
    }

    const res = await request(app)
      .get('/api/audit-logs?limit=10')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ createdAt: string }>;
    for (let i = 1; i < items.length; i++) {
      expect(new Date(items[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(items[i].createdAt).getTime(),
      );
    }
  });
});

// --- AUDIT-05: Filtering ----------------------------------------------------

describeWithDb('AUDIT-05: Filtering by action, userId, and date range', () => {
  it('GET /api/audit-logs?action=CREATE returns only CREATE entries', async () => {
    const manager = await createTestUser('MANAGER');
    const token = await getAuthToken(manager);

    await basePrisma.auditLog.create({
      data: { action: 'CREATE', targetType: 'CREDENTIAL', targetId: 'c1', userId: manager.id },
    });
    await basePrisma.auditLog.create({
      data: { action: 'UPDATE', targetType: 'CREDENTIAL', targetId: 'c2', userId: manager.id },
    });
    await basePrisma.auditLog.create({
      data: { action: 'DELETE', targetType: 'CREDENTIAL', targetId: 'c3', userId: manager.id },
    });

    const res = await request(app)
      .get('/api/audit-logs?action=CREATE')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    for (const item of res.body.items) {
      expect(item.action).toBe('CREATE');
    }
  });

  it('GET /api/audit-logs?userId={id} returns only that user\'s entries', async () => {
    const manager = await createTestUser('MANAGER');
    const other = await createTestUser('MEMBER');
    const token = await getAuthToken(manager);

    await basePrisma.auditLog.create({
      data: { action: 'CREATE', targetType: 'CREDENTIAL', targetId: 'c1', userId: manager.id },
    });
    await basePrisma.auditLog.create({
      data: { action: 'CREATE', targetType: 'CREDENTIAL', targetId: 'c2', userId: other.id },
    });

    const res = await request(app)
      .get(`/api/audit-logs?userId=${manager.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    for (const item of res.body.items) {
      expect(item.userId).toBe(manager.id);
    }
  });

  it('GET /api/audit-logs?startDate=X&endDate=Y returns only entries in range', async () => {
    const manager = await createTestUser('MANAGER');
    const token = await getAuthToken(manager);

    // Entry created now (in range)
    await basePrisma.auditLog.create({
      data: { action: 'CREATE', targetType: 'CREDENTIAL', targetId: 'in-range', userId: manager.id },
    });

    const now = new Date();
    const startDate = new Date(now.getTime() - 60_000).toISOString(); // 1 min ago
    const endDate = new Date(now.getTime() + 60_000).toISOString();   // 1 min ahead

    const res = await request(app)
      .get(`/api/audit-logs?startDate=${startDate}&endDate=${endDate}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);

    for (const item of res.body.items) {
      const ts = new Date(item.createdAt).getTime();
      expect(ts).toBeGreaterThanOrEqual(new Date(startDate).getTime());
      expect(ts).toBeLessThanOrEqual(new Date(endDate).getTime());
    }
  });
});

// --- AUDIT-06: CSV export ---------------------------------------------------

describeWithDb('AUDIT-06: CSV export', () => {
  it('SUPER_ADMIN can export CSV with correct Content-Type (200)', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    await basePrisma.auditLog.create({
      data: { action: 'CREATE', targetType: 'CREDENTIAL', targetId: 'export-cred', userId: admin.id },
    });

    const res = await request(app)
      .get('/api/audit-logs/export')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('CSV export contains correct header row', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    await basePrisma.auditLog.create({
      data: { action: 'CREATE', targetType: 'CREDENTIAL', targetId: 'header-cred', userId: admin.id },
    });

    const res = await request(app)
      .get('/api/audit-logs/export')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const lines = (res.text as string).split('\n');
    expect(lines[0]).toBe('ID,Timestamp,User Email,User Name,Action,Target Type,Target ID,Target Name');
  });

  it('CSV export contains data rows matching audit log entries', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    await basePrisma.auditLog.create({
      data: { action: 'REVEAL', targetType: 'CREDENTIAL', targetId: 'reveal-cred-csv', userId: admin.id },
    });

    const res = await request(app)
      .get('/api/audit-logs/export')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const csvText = res.text as string;
    expect(csvText).toContain('REVEAL');
    expect(csvText).toContain('CREDENTIAL');
    // Should have header + at least 1 data row
    const lines = csvText.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('MANAGER gets 403 on CSV export', async () => {
    const manager = await createTestUser('MANAGER');
    const token = await getAuthToken(manager);

    const res = await request(app)
      .get('/api/audit-logs/export')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// --- RBAC: Access control on audit log endpoints ----------------------------

describeWithDb('RBAC: Audit log access control', () => {
  it('VIEWER gets 403 on GET /api/audit-logs', async () => {
    const viewer = await createTestUser('VIEWER');
    const token = await getAuthToken(viewer);

    const res = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('MEMBER gets 403 on GET /api/audit-logs', async () => {
    const member = await createTestUser('MEMBER');
    const token = await getAuthToken(member);

    const res = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('MANAGER gets 200 on GET /api/audit-logs', async () => {
    const manager = await createTestUser('MANAGER');
    const token = await getAuthToken(manager);

    const res = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('SUPER_ADMIN gets 200 on GET /api/audit-logs', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const res = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('MANAGER gets 403 on GET /api/audit-logs/export', async () => {
    const manager = await createTestUser('MANAGER');
    const token = await getAuthToken(manager);

    const res = await request(app)
      .get('/api/audit-logs/export')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('SUPER_ADMIN gets 200 on GET /api/audit-logs/export', async () => {
    const admin = await createTestUser('SUPER_ADMIN');
    const token = await getAuthToken(admin);

    const res = await request(app)
      .get('/api/audit-logs/export')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});
