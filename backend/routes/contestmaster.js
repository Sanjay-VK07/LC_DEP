const express = require('express');
const router = express.Router();
const contestmasterController = require('../controllers/contestmasterController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

// Get available batches dynamically
router.get('/batches', authenticate, contestmasterController.getContestMasterBatches);

// Live tracker endpoints (placed before platform route param to avoid route parameter collision)
router.get('/live/current', authenticate, contestmasterController.getLiveCurrent);
router.get('/live/students', authenticate, contestmasterController.getLiveStudents);
router.get('/live/analytics', authenticate, contestmasterController.getLiveAnalytics);
router.get('/live/health', authenticate, contestmasterController.getLiveHealth);
router.get('/live/stream', authenticate, contestmasterController.getLiveStream);
router.post('/live/control', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), contestmasterController.triggerLiveControl);

// Get platform-specific analytics and contests
router.get('/:platform', authenticate, contestmasterController.getPlatformAnalytics);

module.exports = router;
