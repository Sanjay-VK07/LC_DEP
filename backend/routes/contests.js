const express = require('express');
const router = express.Router();
const contestController = require('../controllers/contestController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

const leetcodeAttendanceController = require('../controllers/leetcodeContestAttendanceController');

router.get('/', authenticate, contestController.getContests);
router.post('/', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), contestController.addContest);
router.put('/:id', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), contestController.editContest);
router.delete('/:id', authenticate, authorize(['Super Admin']), contestController.deleteContest);

// Registration & Join operations
router.post('/register', authenticate, contestController.registerContest);
router.post('/join', authenticate, contestController.joinContest);

// Automated sync operations & CSV fallback
router.post('/sync', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), contestController.triggerSync);
router.get('/sync-logs', authenticate, contestController.getSyncLogs);
router.post('/import-csv', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), leetcodeAttendanceController.importCsv);

module.exports = router;
