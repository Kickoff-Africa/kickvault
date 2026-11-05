import { ZodError, type ZodType } from 'zod';
import { ValidationError } from './errors.js';

/** Parse request data with a Zod schema, converting failures into a 400 ValidationError. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const path = issue.path.join('.');
      throw new ValidationError(path ? `${path}: ${issue.message}` : issue.message);
    }
    throw err;
  }
}

/** Accept `?x=a,b` or `?x=a&x=b` and return a string[]. */
export function csvList(value: unknown): string[] | undefined {
  if (value === undefined || value === '') return undefined;
  const raw = Array.isArray(value) ? value : [value];
  const items = raw
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}
