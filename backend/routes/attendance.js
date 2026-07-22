const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');
const leetcodeContestAttendanceController = require('../controllers/leetcodeContestAttendanceController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Attendance routes
router.post('/upload', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), upload.single('file'), attendanceController.processContestUpload);
router.post('/override', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), attendanceController.overrideAttendance);
router.get('/contest/:contestId', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), attendanceController.getContestAttendance);
router.get('/contest/:contestId/export', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), attendanceController.exportContestAttendance);
router.get('/student/:studentId', authenticate, attendanceController.getStudentAttendanceHistory);

// LeetCode Contest Ranking Search Attendance
router.post('/leetcode-sync', authenticate, authorize(['Super Admin']), leetcodeContestAttendanceController.syncContest);
router.get('/leetcode-stats', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), leetcodeContestAttendanceController.getStatsAndRecords);

module.exports = router;
