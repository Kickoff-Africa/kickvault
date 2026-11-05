import { Router } from 'express';
import * as c from './assets.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { attachmentUpload } from '../../middleware/upload.js';

const router = Router();

router.post('/api/assets', authenticate, c.create);
router.get('/api/assets', authenticate, c.list);

// Static paths MUST be registered before /:id so they are not captured as an id.
router.get('/api/assets/facets', authenticate, c.facets);
router.post('/api/assets/import/preview', authenticate, c.importPreview);
router.post('/api/assets/import', authenticate, c.importCsv);

router.get('/api/assets/:id', authenticate, c.getOne);
router.patch('/api/assets/:id', authenticate, c.update);
router.delete('/api/assets/:id', authenticate, c.remove);

router.get('/api/assets/:id/financials', authenticate, c.financials);

router.get('/api/assets/:id/checkouts', authenticate, c.listCheckouts);
router.post('/api/assets/:id/checkout', authenticate, c.checkout);
router.post('/api/assets/:id/checkin', authenticate, c.checkin);

router.get('/api/assets/:id/service-history', authenticate, c.listServices);
router.post('/api/assets/:id/service-history', authenticate, c.addService);
router.delete('/api/assets/:id/service-history/:recordId', authenticate, c.removeService);

router.get('/api/assets/:id/attachments', authenticate, c.listAttachments);
router.post('/api/assets/:id/attachments', authenticate, attachmentUpload, c.addAttachment);
router.get('/api/assets/:id/attachments/:attachmentId/download', authenticate, c.downloadAttachment);
router.delete('/api/assets/:id/attachments/:attachmentId', authenticate, c.removeAttachment);

router.post('/api/assets/:id/dispose', authenticate, c.dispose);
router.get('/api/assets/:id/certificate', authenticate, c.certificate);
router.get('/api/assets/:id/label', authenticate, c.label);

export { router as assetsRoutes };
