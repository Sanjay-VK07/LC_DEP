const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const platformStatsController = require('../controllers/platformStatsController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.get('/student/:studentId', analyticsController.getStudentAnalytics);
router.get('/student/:studentId/rating-history', analyticsController.getStudentRatingHistory);
router.get('/student/:studentId/contest-history', analyticsController.getStudentContestHistory);
router.get('/leaderboards', analyticsController.getLeaderboards);
router.get('/portal-summary', analyticsController.getPortalSummary);
router.get('/rating-distribution', analyticsController.getRatingDistribution);

// Relocated from reports routes
router.get('/dashboard-stats', analyticsController.getDashboardStats);
router.get('/platform-stats', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), platformStatsController.getPlatformStats);
router.get('/attendance-matrix', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), platformStatsController.getAttendanceMatrix);

module.exports = router;
