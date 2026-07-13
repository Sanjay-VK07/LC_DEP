const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { JWT_SECRET } = require('../middlewares/authMiddleware');
const auditLog = require('../services/auditLogService');

/**
 * Log in an account and return JWT.
 */
async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  try {
    const rows = await db.query(
      'SELECT id, username, password_hash, role, name, email, student_id FROM Accounts WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    const account = rows[0];
    const match = await bcrypt.compare(password, account.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: account.id,
        username: account.username,
        role: account.role,
        studentId: account.student_id,
        name: account.name
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await auditLog.log('LOGIN_SUCCESS', {
      actor: account.username,
      targetType: 'account',
      targetId: account.id,
      details: { role: account.role, ip: req.ip }
    });

    return res.json({
      success: true,
      token,
      user: {
        id: account.id,
        username: account.username,
        role: account.role,
        name: account.name,
        email: account.email,
        studentId: account.student_id
      }
    });
  } catch (err) {
    console.error('[Auth] Login error - Complete stack trace:');
    console.error(err);
    return res.status(500).json({ success: false, message: 'Internal server error during login' });
  }
}

/**
 * Register a new staff account (Super Admin only).
 */
async function register(req, res) {
  const { username, password, role, name, email, studentId } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ success: false, message: 'Username, password, and role are required' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      `INSERT INTO Accounts (username, password_hash, role, name, email, student_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, hash, role, name || null, email || null, studentId || null]
    );

    await auditLog.log('ACCOUNT_CREATED', {
      actor: req.user?.username || 'SYSTEM',
      targetType: 'account',
      targetId: username,
      details: { role, name }
    });

    return res.status(201).json({ success: true, message: `Account for ${username} created successfully` });
  } catch (err) {
    console.error('[Auth] Register error - Complete stack trace:');
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Username or email already exists' });
    }
    return res.status(500).json({ success: false, message: 'Failed to register account due to an internal server error' });
  }
}

/**
 * Get details of current logged-in user.
 */
async function me(req, res) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const rows = await db.query(
      'SELECT id, username, role, name, email, student_id, created_at FROM Accounts WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    return res.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('[Auth] Get current user details error - Complete stack trace:');
    console.error(err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = {
  login,
  register,
  me
};
