import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../lib/errors.js';
import type { Role } from '@prisma/client';

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userRole = req.user?.role as Role | undefined;
    if (!userRole) throw new ForbiddenError();
    if (userRole === 'SUPER_ADMIN') { next(); return; }
    if (!allowedRoles.includes(userRole)) throw new ForbiddenError();
    next();
  };
}
