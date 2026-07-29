import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app.js';
import { prisma } from '../../config/database.js';
import { hashPassword } from '../../services/password.service.js';
import * as emailService from '../../services/email.service.js';

// Check database connectivity
const canConnect = await prisma
  .$connect()
  .then(() => true)
  .catch(() => false);
const describeWithDb = canConnect ? describe : describe.skip;

const TEST_EMAIL = 'test@kickvault.test';
const TEST_PASSWORD = 'SuperSecure123!';
let testPasswordHash: string;

beforeAll(async () => {
  if (!canConnect) return;
  testPasswordHash = await hashPassword(TEST_PASSWORD);
});

async function createTestUser(
  overrides?: Partial<{
    isActive: boolean;
    failedAttempts: number;
    lockedUntil: Date | null;
  }>,
) {
  return prisma.user.create({
    data: {
      email: TEST_EMAIL,
      name: 'Test User',
      passwordHash: testPasswordHash,
      role: 'MEMBER',
      isActive: overrides?.isActive ?? true,
      failedAttempts: overrides?.failedAttempts ?? 0,
      lockedUntil: overrides?.lockedUntil ?? null,
    },
  });
}

beforeEach(async () => {
  if (!canConnect) return;
  vi.restoreAllMocks();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  if (!canConnect) return;
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describeWithDb('AUTH-01: Login', () => {
  it('returns access and refresh tokens on valid login', async () => {
    await createTestUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body).toHaveProperty('expiresIn');
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
  });

  it('returns 401 on wrong password', async () => {
    await createTestUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'WrongPassword123!' });

    expect(res.status).toBe(401);
  });

  it('returns 401 for non-existent email (same as wrong password)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@kickvault.test', password: TEST_PASSWORD });

    expect(res.status).toBe(401);
  });

  it('returns 401 for inactive user', async () => {
    await createTestUser({ isActive: false });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid body', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: '' });

    expect(res.status).toBe(400);
  });
});

describeWithDb('AUTH-02: Account lockout', () => {
  it('locks account after 5 failed attempts', async () => {
    await createTestUser();

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: TEST_EMAIL, password: 'WrongPassword!' });
      expect(res.status).toBe(401);
    }

    // Verify DB state
    const user = await prisma.user.findUnique({
      where: { email: TEST_EMAIL },
    });
    expect(user!.failedAttempts).toBe(5);
    expect(user!.lockedUntil).not.toBeNull();

    // 6th attempt returns 403 (locked)
    const lockedRes = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'WrongPassword!' });
    expect(lockedRes.status).toBe(403);
  });

  it('resets failedAttempts to 0 on successful login', async () => {
    await createTestUser({ failedAttempts: 3 });
    await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const user = await prisma.user.findUnique({
      where: { email: TEST_EMAIL },
    });
    expect(user!.failedAttempts).toBe(0);
    expect(user!.lockedUntil).toBeNull();
  });

  it('rejects login when account is already locked', async () => {
    await createTestUser({
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
      failedAttempts: 5,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
  });
});

describeWithDb('AUTH-03: Session inactivity expiry', () => {
  it('refreshes successfully with valid session', async () => {
    await createTestUser();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const { refreshToken } = loginRes.body;

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body).toHaveProperty('accessToken');
    expect(refreshRes.body).toHaveProperty('refreshToken');
  });

  it('rejects refresh when session is inactive (past inactivity timeout)', async () => {
    await createTestUser();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const { refreshToken } = loginRes.body;

    // Manually push lastActiveAt into the past (16 min ago, beyond 15-min timeout)
    const pastTime = new Date(Date.now() - 16 * 60 * 1000);
    await prisma.session.updateMany({
      data: { lastActiveAt: pastTime },
    });

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });
    expect(refreshRes.status).toBe(401);
  });

  it('rejects refresh with invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'invalid-token-xyz' });
    expect(res.status).toBe(401);
  });
});

describeWithDb('AUTH-04: Logout invalidates ALL sessions', () => {
  it('logout returns 200 and invalidates all sessions', async () => {
    const user = await createTestUser();

    // Log in twice to create two sessions
    const login1 = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const login2 = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const { accessToken } = login1.body;
    const refreshToken2 = login2.body.refreshToken;

    // Verify 2 sessions exist
    const sessionCount = await prisma.session.count({
      where: { userId: user.id },
    });
    expect(sessionCount).toBe(2);

    // Logout with first session's access token
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logoutRes.status).toBe(200);

    // Both sessions should be gone
    const remainingSessions = await prisma.session.count({
      where: { userId: user.id },
    });
    expect(remainingSessions).toBe(0);

    // Refreshing with the second session's token should fail
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: refreshToken2 });
    expect(refreshRes.status).toBe(401);
  });

  it('returns 401 when logout is called without auth token', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});

describeWithDb('AUTH-05: Password reset via email', () => {
  it('forgot-password returns 200 for existing email and calls email service', async () => {
    await createTestUser();

    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(emailService, 'sendPasswordResetEmail').mockImplementation(
      sendMock,
    );

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: TEST_EMAIL });

    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledOnce();
    expect(sendMock.mock.calls[0][0]).toBe(TEST_EMAIL);
  });

  it('forgot-password returns 200 even for non-existent email (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@kickvault.test' });
    expect(res.status).toBe(200);
  });

  it('resets password with valid token and new password', async () => {
    await createTestUser();

    let capturedToken = '';
    vi.spyOn(emailService, 'sendPasswordResetEmail').mockImplementation(
      async (_to, token) => {
        capturedToken = token;
      },
    );

    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: TEST_EMAIL });

    expect(capturedToken).not.toBe('');

    const newPassword = 'NewSecurePassword456!';
    const resetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: capturedToken, password: newPassword });
    expect(resetRes.status).toBe(200);

    // Can log in with new password
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: newPassword });
    expect(loginRes.status).toBe(200);
  });

  it('rejects reset with invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'invalid-token', password: 'NewSecure123456!' });
    expect(res.status).toBe(401);
  });

  it('rejects reset with expired token', async () => {
    const user = await createTestUser();
    const { hashToken } = await import('../../services/token.service.js');
    const fakeToken = 'fake-token-for-test';
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: hashToken(fakeToken),
        resetTokenExpiry: new Date(Date.now() - 1000), // already expired
      },
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: fakeToken, password: 'NewSecure123456!' });
    expect(res.status).toBe(401);
  });
});
