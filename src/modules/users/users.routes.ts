import { Router } from 'express';
import * as usersController from './users.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { avatarUpload } from '../../middleware/upload.js';

const router = Router();

// /me/* MUST come before /:id to prevent 'me' being captured as :id
router.get('/api/users/me', authenticate, usersController.getProfile);
router.patch('/api/users/me', authenticate, usersController.updateProfile);
router.post('/api/users/me/avatar', authenticate, avatarUpload, usersController.uploadAvatar);
router.delete('/api/users/me/avatar', authenticate, usersController.removeAvatar);
router.post('/api/users/me/password', authenticate, usersController.changePassword);
router.delete('/api/users/me', authenticate, usersController.deleteMe);
router.get('/api/users/me/preferences', authenticate, usersController.getPreferences);
router.patch('/api/users/me/preferences', authenticate, usersController.updatePreferences);
router.get('/api/users/me/login-history', authenticate, usersController.loginHistory);
router.post('/api/users/me/2fa/setup', authenticate, usersController.totpSetup);
router.post('/api/users/me/2fa/enable', authenticate, usersController.totpEnable);
router.post('/api/users/me/2fa/disable', authenticate, usersController.totpDisable);

// Static /lookup and /stats MUST come before /:id.
router.get('/api/users/lookup', authenticate, usersController.lookup);
router.get('/api/users/stats', authenticate, requireRole('MANAGER'), usersController.stats);
router.post('/api/users/invite', authenticate, requireRole(), usersController.invite);
router.get('/api/users', authenticate, requireRole('MANAGER'), usersController.list);
router.get('/api/users/:id', authenticate, requireRole('MANAGER'), usersController.getById);
router.patch('/api/users/:id', authenticate, requireRole(), usersController.update);
router.post('/api/users/:id/deactivate', authenticate, requireRole(), usersController.deactivate);
router.post('/api/users/:id/reactivate', authenticate, requireRole(), usersController.reactivate);
router.delete('/api/users/:id', authenticate, requireRole(), usersController.hardDelete);
router.post('/api/users/:id/resend-invite', authenticate, requireRole(), usersController.resendInvite);

export { router as userRoutes };
