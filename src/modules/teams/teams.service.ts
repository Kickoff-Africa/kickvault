import type { PermissionLevel } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { createAuditLog, type AuditParams } from '../../services/audit.service.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import type { CreateTeamInput, UpdateTeamInput } from './teams.validation.js';

type Ctx = Pick<AuditParams, 'ipAddress' | 'userAgent'>;

async function assertUsersExist(ids: string[]) {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const found = await prisma.user.count({ where: { id: { in: unique }, deletedAt: null, isActive: true } });
  if (found !== unique.length) throw new ValidationError('One or more members do not exist or are not active');
}

export async function listTeams(search?: string) {
  const teams = await prisma.team.findMany({
    where: search
      ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] }
      : {},
    orderBy: { createdAt: 'desc' },
    include: {
      members: { take: 5, orderBy: { joinedAt: 'asc' }, include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
      _count: { select: { members: true, assets: true, credentials: true } },
    },
  });
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    memberPreview: t.members.map((m) => m.user),
    memberCount: t._count.members,
    assetCount: t._count.assets,
    credentialCount: t._count.credentials,
    createdAt: t.createdAt,
  }));
}

export async function getTeam(id: string) {
  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, role: true, avatarUrl: true } } }, orderBy: { joinedAt: 'asc' } },
      assets: { include: { asset: { select: { id: true, assetId: true, name: true, deletedAt: true } } } },
      credentials: { include: { credential: { select: { id: true, friendlyName: true, credType: true, deletedAt: true } } } },
    },
  });
  if (!team) throw new NotFoundError('Team not found');
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    createdAt: team.createdAt,
    members: team.members.map((m) => m.user),
    assets: team.assets.filter((a) => !a.asset.deletedAt).map((a) => ({ id: a.asset.id, assetId: a.asset.assetId, name: a.asset.name, permission: a.permission })),
    credentials: team.credentials
      .filter((c) => !c.credential.deletedAt)
      .map((c) => ({ id: c.credential.id, friendlyName: c.credential.friendlyName, credType: c.credential.credType, permission: c.permission })),
  };
}

export async function createTeam(input: CreateTeamInput, userId: string, ctx: Ctx = {}) {
  if (await prisma.team.findUnique({ where: { name: input.name }, select: { id: true } })) {
    throw new ConflictError('A team with this name already exists');
  }
  await assertUsersExist(input.memberIds);
  const team = await prisma.team.create({
    data: {
      name: input.name,
      description: input.description,
      createdById: userId,
      members: { create: [...new Set(input.memberIds)].map((id) => ({ userId: id })) },
    },
    select: { id: true },
  });
  await createAuditLog({ userId, action: 'CREATE', targetType: 'TEAM', targetId: team.id, ...ctx });
  return getTeam(team.id);
}

export async function updateTeam(id: string, input: UpdateTeamInput, userId: string, ctx: Ctx = {}) {
  const existing = await prisma.team.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!existing) throw new NotFoundError('Team not found');
  if (input.name && input.name !== existing.name) {
    if (await prisma.team.findUnique({ where: { name: input.name }, select: { id: true } })) {
      throw new ConflictError('A team with this name already exists');
    }
  }
  if (input.memberIds) await assertUsersExist(input.memberIds);

  await prisma.$transaction(async (tx) => {
    await tx.team.update({ where: { id }, data: { name: input.name, description: input.description } });
    if (input.memberIds) {
      const wanted = new Set(input.memberIds);
      await tx.teamMember.deleteMany({ where: { teamId: id, userId: { notIn: [...wanted] } } });
      const have = new Set((await tx.teamMember.findMany({ where: { teamId: id }, select: { userId: true } })).map((m) => m.userId));
      const toAdd = [...wanted].filter((u) => !have.has(u));
      if (toAdd.length) await tx.teamMember.createMany({ data: toAdd.map((userId) => ({ teamId: id, userId })) });
    }
  });
  await createAuditLog({ userId, action: 'EDIT', targetType: 'TEAM', targetId: id, ...ctx });
  return getTeam(id);
}

export async function deleteTeam(id: string, userId: string, ctx: Ctx = {}) {
  const existing = await prisma.team.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError('Team not found');
  await prisma.team.delete({ where: { id } });
  await createAuditLog({ userId, action: 'DELETE', targetType: 'TEAM', targetId: id, ...ctx });
}

export async function assignAsset(teamId: string, assetId: string, permission: PermissionLevel, userId: string, ctx: Ctx = {}) {
  if (!(await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } }))) throw new NotFoundError('Team not found');
  if (!(await prisma.asset.findFirst({ where: { id: assetId, deletedAt: null }, select: { id: true } }))) throw new NotFoundError('Asset not found');
  await prisma.teamAsset.upsert({
    where: { teamId_assetId: { teamId, assetId } },
    create: { teamId, assetId, permission },
    update: { permission },
  });
  await createAuditLog({ userId, action: 'SHARE', targetType: 'ASSET', targetId: assetId, metadata: { teamId, permission }, ...ctx });
  return getTeam(teamId);
}

export async function unassignAsset(teamId: string, assetId: string, userId: string, ctx: Ctx = {}) {
  const res = await prisma.teamAsset.deleteMany({ where: { teamId, assetId } });
  if (res.count === 0) throw new NotFoundError('Assignment not found');
  await createAuditLog({ userId, action: 'REVOKE_SHARE', targetType: 'ASSET', targetId: assetId, metadata: { teamId }, ...ctx });
}

export async function assignCredential(teamId: string, credentialId: string, permission: PermissionLevel, userId: string, ctx: Ctx = {}) {
  if (!(await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } }))) throw new NotFoundError('Team not found');
  if (!(await prisma.credential.findFirst({ where: { id: credentialId, deletedAt: null }, select: { id: true } }))) {
    throw new NotFoundError('Credential not found');
  }
  await prisma.teamCredential.upsert({
    where: { teamId_credentialId: { teamId, credentialId } },
    create: { teamId, credentialId, permission },
    update: { permission },
  });
  await createAuditLog({ userId, action: 'SHARE', targetType: 'CREDENTIAL', targetId: credentialId, metadata: { teamId, permission }, ...ctx });
  return getTeam(teamId);
}

export async function unassignCredential(teamId: string, credentialId: string, userId: string, ctx: Ctx = {}) {
  const res = await prisma.teamCredential.deleteMany({ where: { teamId, credentialId } });
  if (res.count === 0) throw new NotFoundError('Assignment not found');
  await createAuditLog({ userId, action: 'REVOKE_SHARE', targetType: 'CREDENTIAL', targetId: credentialId, metadata: { teamId }, ...ctx });
}
