const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const platformStatsController = require('../controllers/platformStatsController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.get('/dashboard-stats', reportController.getDashboardStats);
router.get('/contests', reportController.getContestsReport);
router.get('/students', reportController.getStudentsReport);
router.get('/departments', reportController.getDepartmentReport);
router.get('/sections', reportController.getSectionReport);
router.get('/heatmap', reportController.getAttendanceHeatmap);
router.get('/attendance-log', reportController.getAttendanceLog);
router.get('/faculty-summary', reportController.getFacultySummary);

// New platform stats + attendance matrix endpoints
router.get('/platform-stats', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), platformStatsController.getPlatformStats);
router.get('/attendance-matrix', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), platformStatsController.getAttendanceMatrix);

module.exports = router;
