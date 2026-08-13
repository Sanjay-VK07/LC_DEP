const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.get('/', healthController.getSystemHealth);
router.get('/system', healthController.getSystemHealth);
router.get('/migrations', authenticate, authorize(['Super Admin', 'HOD']), healthController.getMigrationHealth);
router.get('/platform', healthController.getPlatformHealth);
router.get('/platform/:platform', healthController.getPlatformHealth);
router.get('/providers/clist', healthController.getClistHealth);

module.exports = router;
