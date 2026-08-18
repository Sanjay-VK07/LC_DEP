const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const multer = require('multer');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Student CRUD
router.get('/', authenticate, studentController.getStudents);
router.post('/', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), studentController.addStudent);
router.put('/:id', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), studentController.editStudent);
router.delete('/:id', authenticate, authorize(['Super Admin']), studentController.deleteStudent);

// Bulk operations
router.post('/import', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), upload.single('file'), studentController.bulkImportStudents);
router.get('/import-history', authenticate, studentController.getImportHistory);
router.post('/bulk-delete', authenticate, authorize(['Super Admin']), studentController.bulkDeleteStudents);
router.post('/archive', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), studentController.archiveStudents);
router.post('/restore', authenticate, authorize(['Super Admin', 'Faculty', 'HOD']), studentController.restoreStudents);
router.get('/archive-summary', authenticate, studentController.getArchivedSummary);
router.get('/batches', authenticate, studentController.getUniqueBatches);
router.get('/sections', authenticate, studentController.getUniqueSections);

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
