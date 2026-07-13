const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

router.get('/dashboard-stats', reportController.getDashboardStats);
router.get('/contests', reportController.getContestsReport);
router.get('/students', reportController.getStudentsReport);
router.get('/departments', reportController.getDepartmentReport);
router.get('/sections', reportController.getSectionReport);
router.get('/heatmap', reportController.getAttendanceHeatmap);
router.get('/attendance-log', reportController.getAttendanceLog);

module.exports = router;
