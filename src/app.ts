import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { pinoHttp } from 'pino-http';
import { logger } from './lib/logger.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { userRoutes } from './modules/users/users.routes.js';
import { credentialAccessRoutes } from './modules/credential-access/credential-access.routes.js';
import { assetAccessRoutes } from './modules/asset-access/asset-access.routes.js';
import { credentialsRoutes } from './modules/credentials/credentials.routes.js';
import { assetsRoutes } from './modules/assets/assets.routes.js';
import { auditLogsRoutes } from './modules/audit-logs/audit-logs.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { sessionsRoutes } from './modules/sessions/sessions.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { registerSwagger } from './lib/swagger.js';

const app = express();

app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled so Swagger UI loads
app.use(
  cors({
    origin: env.NODE_ENV === 'production' ? env.FRONTEND_URL : true,
    credentials: true,
  }),
);
app.use(
  pinoHttp({
    logger,
    // Assign a request ID to every request
    genReqId: (req) =>
      (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
    // What gets logged on request completion
    customSuccessMessage: (req, res) =>
      `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${req.url} ${res.statusCode} — ${err.message}`,
    // Slim down the logged request/response objects
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
    // Don't log health checks — they're just noise
    customLogLevel: (_req, res, err) => {
      if (err) return 'error';
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: {
      ignore: (req) => req.url?.startsWith('/health') ?? false,
    },
  }),
);
app.use(express.json());
app.use(healthRoutes);
app.use(authRoutes);
app.use(userRoutes);
app.use(credentialAccessRoutes);
app.use(assetAccessRoutes);
app.use(credentialsRoutes);
app.use(assetsRoutes);
app.use(auditLogsRoutes);
app.use(dashboardRoutes);
app.use(sessionsRoutes);
registerSwagger(app);
app.use(errorHandler);

export { app };
