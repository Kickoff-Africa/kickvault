import { Router } from 'express';
import * as authController from './auth.controller.js';
import { authenticate } from '../../middleware/authenticate.js';

const router = Router();

router.post('/api/auth/login', authController.login);
router.post('/api/auth/logout', authenticate, authController.logout);
router.post('/api/auth/refresh', authController.refresh);
router.post('/api/auth/forgot-password', authController.forgotPassword);
router.post('/api/auth/reset-password', authController.resetPassword);

export { router as authRoutes };
