const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticate } = require('../middlewares/authMiddleware');

router.get('/', authenticate, notificationController.getNotifications);
router.get('/count', authenticate, notificationController.getUnreadCount);
router.post('/read/:id', authenticate, notificationController.markAsRead);
router.post('/read-all', authenticate, notificationController.markAllAsRead);
router.post('/archive/:id', authenticate, notificationController.archiveNotification);

module.exports = router;
