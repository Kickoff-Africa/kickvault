import { Router } from 'express';
import * as credentialAccessController from './credential-access.controller.js';
import { authenticate } from '../../middleware/authenticate.js';

const router = Router();

// Authorization (MANAGE on the credential) is enforced in the controller.
router.post('/api/credentials/:credentialId/access', authenticate, credentialAccessController.grant);
router.delete('/api/credentials/:credentialId/access/:userId', authenticate, credentialAccessController.revoke);
router.get('/api/credentials/:credentialId/access', authenticate, credentialAccessController.list);

export { router as credentialAccessRoutes };
