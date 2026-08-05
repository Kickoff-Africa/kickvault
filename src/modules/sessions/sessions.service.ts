import { prisma } from '../../config/database.js';
import { NotFoundError, ForbiddenError } from '../../lib/errors.js';

const SESSION_SELECT = {
  id: true,
  deviceName: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
  lastActiveAt: true,
  expiresAt: true,
} as const;

export async function listSessions(userId: string, currentSessionId: string) {
  const sessions = await prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: SESSION_SELECT,
    orderBy: { lastActiveAt: 'desc' },
  });

  return sessions.map((s) => ({ ...s, isCurrent: s.id === currentSessionId }));
}

export async function revokeSession(
  sessionId: string,
  userId: string,
  currentSessionId: string,
) {
  if (sessionId === currentSessionId) {
    throw new ForbiddenError('Use the logout endpoint to end your current session.');
  }

  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) throw new NotFoundError('Session not found');

  await prisma.session.delete({ where: { id: sessionId } });
}

export async function revokeAllOtherSessions(userId: string, currentSessionId: string) {
  await prisma.session.deleteMany({
    where: { userId, id: { not: currentSessionId } },
  });
}
