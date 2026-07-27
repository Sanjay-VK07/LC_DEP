const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

// Public auth routes
router.post('/login', authController.login);

// Helper route for direct browser GET navigation (returns 405 Method Not Allowed)
router.get('/login', (req, res) => {
  res.status(405).json({
    success: false,
    message: 'The /api/auth/login endpoint requires an HTTP POST request with { username, password } body. Direct GET access in browser address bar is not supported.'
  });
});

// Protected auth routes
router.get('/me', authenticate, authController.me);
router.post('/register', authenticate, authorize(['Super Admin']), authController.register);

module.exports = router;
