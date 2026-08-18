const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticate } = require('../middlewares/authMiddleware');

router.get('/dashboard-stats', authenticate, reportController.getDashboardStats);
router.get('/contests', authenticate, reportController.getContestsReport);
router.get('/students', authenticate, reportController.getStudentsReport);
router.get('/departments', authenticate, reportController.getDepartmentReport);
router.get('/sections', authenticate, reportController.getSectionReport);
router.get('/heatmap', authenticate, reportController.getAttendanceHeatmap);
router.get('/attendance-log', authenticate, reportController.getAttendanceLog);

module.exports = router;
