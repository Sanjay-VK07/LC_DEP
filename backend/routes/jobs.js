const express = require('express');
const router = express.Router();
const jobController = require('../controllers/jobController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

// Protect all routes with JWT authentication
router.use(authenticate);

// Job queue management routes with role-based checks
router.get('/', authorize(['Super Admin', 'HOD', 'Faculty', 'Placement Coordinator', 'Student']), jobController.listJobs);
router.get('/cache', authorize(['Super Admin', 'HOD', 'Faculty']), jobController.getCacheStats);
router.post('/cache/invalidate', authorize(['Super Admin', 'HOD', 'Faculty']), jobController.invalidateCache);
router.post('/sync', authorize(['Super Admin', 'HOD', 'Faculty']), jobController.triggerSyncJob);
router.post('/analytics-recalc', authorize(['Super Admin', 'HOD', 'Faculty']), jobController.triggerAnalyticsRecalc);
router.post('/backfill', authorize(['Super Admin', 'HOD', 'Faculty']), jobController.triggerAttendanceBackfill);
router.get('/:id/download', authorize(['Super Admin', 'HOD', 'Faculty', 'Placement Coordinator', 'Student']), jobController.downloadJobFile);
router.get('/:id', authorize(['Super Admin', 'HOD', 'Faculty', 'Placement Coordinator', 'Student']), jobController.getJob);
router.post('/:id/cancel', authorize(['Super Admin', 'HOD', 'Faculty']), jobController.cancelJob);

module.exports = router;
