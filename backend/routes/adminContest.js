/**
 * adminContest.js
 * ===============
 * Routes for administrative contest operations (Reset & Re-Sync).
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const adminContestController = require('../controllers/adminContestController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

const adminRoles = ['Super Admin', 'Faculty', 'HOD'];

// Pre-delete dry run preview
router.get('/:contestId/reset/preview', authenticate, authorize(adminRoles), adminContestController.previewContestReset);
router.post('/:contestId/reset/preview', authenticate, authorize(adminRoles), adminContestController.previewContestReset);

// Execute contest reset
router.post('/:contestId/reset', authenticate, authorize(adminRoles), adminContestController.resetContestData);
router.delete('/:contestId/data', authenticate, authorize(adminRoles), adminContestController.resetContestData);

// Trigger clean re-sync starting from page 1
router.post('/:contestId/sync', authenticate, authorize(adminRoles), adminContestController.syncContestData);

module.exports = router;
