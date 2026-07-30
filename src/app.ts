import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { logger } from './lib/logger.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { userRoutes } from './modules/users/users.routes.js';
import { credentialAccessRoutes } from './modules/credential-access/credential-access.routes.js';
import { assetAccessRoutes } from './modules/asset-access/asset-access.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(pinoHttp({ logger }));
app.use(express.json());
app.use(healthRoutes);
app.use(authRoutes);
app.use(userRoutes);
app.use(credentialAccessRoutes);
app.use(assetAccessRoutes);
app.use(errorHandler);

export { app };
