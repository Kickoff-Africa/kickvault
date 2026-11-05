import { prisma } from '../../config/database.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';

export async function findDepartmentByName(name: string) {
  return prisma.department.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } });
}

export async function requireDepartmentByName(name: string) {
  const dept = await findDepartmentByName(name);
  if (!dept) throw new ValidationError(`Department "${name}" does not exist. Create it first.`);
  return dept;
}

export async function listDepartments() {
  const departments = await prisma.department.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, _count: { select: { assets: { where: { deletedAt: null } } } } },
  });
  return departments.map(({ _count, ...d }) => ({ ...d, assetCount: _count.assets }));
}

export async function createDepartment(name: string) {
  const clean = name.trim();
  if (await findDepartmentByName(clean)) throw new ConflictError('Department already exists');
  return prisma.department.create({ data: { name: clean }, select: { id: true, name: true } });
}

export async function getOrCreateDepartment(name: string) {
  return (await findDepartmentByName(name)) ?? createDepartment(name);
}
