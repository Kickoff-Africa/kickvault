import { Router } from 'express';
import * as usersController from './users.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

// /me/* MUST come before /:id to prevent 'me' being captured as :id
router.get('/api/users/me', authenticate, usersController.getProfile);
router.patch('/api/users/me', authenticate, usersController.updateProfile);
router.post('/api/users/me/password', authenticate, usersController.changePassword);
router.post('/api/users/invite', authenticate, requireRole(), usersController.invite);
router.get('/api/users', authenticate, requireRole('MANAGER'), usersController.list);
router.get('/api/users/:id', authenticate, requireRole('MANAGER'), usersController.getById);
router.patch('/api/users/:id', authenticate, requireRole(), usersController.update);
router.post('/api/users/:id/deactivate', authenticate, requireRole(), usersController.deactivate);
router.post('/api/users/:id/resend-invite', authenticate, requireRole(), usersController.resendInvite);

export { router as userRoutes };
