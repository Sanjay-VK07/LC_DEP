const express = require('express');
const router = express.Router();
const contestController = require('../controllers/contestController');

const leetcodeAttendanceController = require('../controllers/leetcodeContestAttendanceController');

router.get('/', contestController.getContests);
router.post('/', contestController.addContest);
router.put('/:id', contestController.editContest);
router.delete('/:id', contestController.deleteContest);

// Registration & Join operations
router.post('/register', contestController.registerContest);
router.post('/join', contestController.joinContest);

// Automated sync operations & CSV fallback
router.post('/sync', contestController.triggerSync);
router.get('/sync-logs', contestController.getSyncLogs);
router.post('/import-csv', leetcodeAttendanceController.importCsv);

module.exports = router;
