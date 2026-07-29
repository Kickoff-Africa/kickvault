import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error({ err, path: req.path, method: req.method }, 'Request error');

  if (err instanceof AppError) {
    res
      .status(err.statusCode)
      .json({ error: { message: err.message, statusCode: err.statusCode } });
    return;
  }

  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message;
  res.status(500).json({ error: { message, statusCode: 500 } });
}
