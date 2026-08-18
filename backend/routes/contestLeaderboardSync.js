/**
 * contestLeaderboardSync.js
 * =========================
 * Route definitions for LeetCode Leaderboard Sync.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/contestLeaderboardSyncController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

// Start background synchronization
router.post('/sync/:contestSlug', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), controller.startSync);

// Get synchronization background job status
router.get('/sync/status/:jobId', authenticate, controller.getSyncStatus);

// Cancel active/pending sync job
router.post('/sync/cancel/:jobId', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), controller.cancelSync);

// Retry a failed or cancelled sync job
router.post('/sync/retry/:jobId', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), controller.retrySync);

// View memory active jobs and database sync history logs
router.get('/sync/history', authenticate, controller.getSyncHistory);

module.exports = router;
