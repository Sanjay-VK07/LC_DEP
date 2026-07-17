const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Student CRUD
router.get('/', studentController.getStudents);
router.post('/', studentController.addStudent);
router.put('/:id', studentController.editStudent);
router.delete('/:id', studentController.deleteStudent);

// Bulk operations
router.post('/import', upload.single('file'), studentController.bulkImportStudents);
router.post('/bulk-delete', studentController.bulkDeleteStudents);
router.post('/archive', studentController.archiveStudents);
router.post('/restore', studentController.restoreStudents);
router.get('/archive-summary', studentController.getArchivedSummary);
router.get('/batches', studentController.getUniqueBatches);
router.get('/sections', studentController.getUniqueSections);

const { authenticate, authorize } = require('../middlewares/authMiddleware');
router.get('/data-health', authenticate, authorize(['Super Admin']), studentController.getStudentsDataHealth);
router.post('/:id/sync/:platform', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), studentController.syncStudentPlatformManual);
router.post('/sync-all', authenticate, authorize(['Super Admin']), studentController.forceFullSync);
router.post('/clear-cache', authenticate, authorize(['Super Admin']), studentController.clearCacheManual);

// Handle verification helper
router.get('/verify-leetcode/:username', studentController.checkUsername);
router.get('/verify-platform/:platform/:username', studentController.checkPlatformUsername);

// Unified profile and platform stats routes
router.get('/:id/unified-profile', studentController.getUnifiedProfileById);
router.get('/:id/leetcode-stats', studentController.getLeetCodeStatsById);

module.exports = router;
