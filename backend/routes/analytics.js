const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');

router.get('/student/:studentId', analyticsController.getStudentAnalytics);
router.get('/student/:studentId/rating-history', analyticsController.getStudentRatingHistory);
router.get('/student/:studentId/contest-history', analyticsController.getStudentContestHistory);
router.get('/leaderboards', analyticsController.getLeaderboards);
router.get('/portal-summary', analyticsController.getPortalSummary);
router.get('/rating-distribution', analyticsController.getRatingDistribution);

module.exports = router;
