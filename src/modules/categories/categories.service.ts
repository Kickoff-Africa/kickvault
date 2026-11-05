import { prisma } from '../../config/database.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';

export function derivePrefix(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  return (letters.slice(0, 2) || 'XX').padEnd(2, 'X');
}

export async function findCategoryByName(name: string) {
  return prisma.category.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } });
}

export async function requireCategoryByName(name: string) {
  const category = await findCategoryByName(name);
  if (!category) throw new ValidationError(`Category "${name}" does not exist. Create it first.`);
  return category;
}

export async function listCategories() {
  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, prefix: true, _count: { select: { assets: { where: { deletedAt: null } } } } },
  });
  return categories.map(({ _count, ...c }) => ({ ...c, assetCount: _count.assets }));
}

export async function createCategory(name: string) {
  const clean = name.trim();
  if (await findCategoryByName(clean)) throw new ConflictError('Category already exists');
  return prisma.category.create({
    data: { name: clean, prefix: derivePrefix(clean) },
    select: { id: true, name: true, prefix: true },
  });
}

export async function getOrCreateCategory(name: string) {
  return (await findCategoryByName(name)) ?? createCategory(name);
}
