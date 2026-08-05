import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    // 4xx — expected, not worth logging as an error
    if (err.statusCode < 500) {
      logger.warn({ statusCode: err.statusCode, path: req.path }, err.message);
    } else {
      logger.error({ err, path: req.path }, err.message);
    }
    res.status(err.statusCode).json({ error: { message: err.message, statusCode: err.statusCode } });
    return;
  }

  // Unexpected error
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  const message = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message;
  res.status(500).json({ error: { message, statusCode: 500 } });
}
