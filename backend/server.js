const express = require('express');
const cors = require('cors');
require('dotenv').config();
const requestLogger = require('./middlewares/loggingMiddleware');
const errorHandler = require('./middlewares/errorHandler');
const { initializeDatabase, query, getConnectionStatus } = require('./config/db');
const { initScheduler, seedMasterContests } = require('./utils/scheduler');

// Import routes
const studentRoutes = require('./routes/students');
const contestRoutes = require('./routes/contests');
const attendanceRoutes = require('./routes/attendance');
const analyticsRoutes = require('./routes/analytics');
const notificationRoutes = require('./routes/notifications');
const departmentRoutes = require('./routes/departments');
const jobRoutes = require('./routes/jobs');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const contestmasterRoutes = require('./routes/contestmaster');
const contestLeaderboardSyncRoutes = require('./routes/contestLeaderboardSync');
const placementRoutes = require('./routes/placement');
const aiRoutes = require('./routes/ai');
const verificationRoutes = require('./routes/verificationRoutes');
const adminContestRoutes = require('./routes/adminContest');

const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3001;

// Production & Development allowed origin list (normalized without trailing slashes)
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://college-teal-ten.vercel.app",
  process.env.FRONTEND_URL
].filter(Boolean).map(url => url.trim().replace(/\/+$/, ''));

// Production-ready CORS configuration
const corsOptions = {
  origin(origin, callback) {
    // Print incoming origin for debugging and audit tracing in Render logs
    console.log("Incoming Origin:", origin);

    // 1. Allow requests with no origin (curl, postman, same-origin, mobile apps)
    if (!origin) return callback(null, true);

    const cleanOrigin = origin.trim().replace(/\/+$/, '');
    const cleanFrontendUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.trim().replace(/\/+$/, '') : '';

    // 2. Exact match check against allowed origins list or process.env.FRONTEND_URL
    const isAllowed = allowedOrigins.includes(cleanOrigin) ||
                      (cleanFrontendUrl && cleanOrigin === cleanFrontendUrl) ||
                      process.env.NODE_ENV !== 'production';

    if (isAllowed) {
      // Pass string cleanOrigin so Access-Control-Allow-Origin echoes requesting origin and credentials: true works
      return callback(null, cleanOrigin);
    }

    console.warn(`[CORS Audit] Rejected origin: "${origin}"`);
    // NEVER throw an Error from the CORS callback. Returning false omits CORS headers safely without triggering 500 errors.
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 204
};

// 1. Register CORS middleware and global OPTIONS handling BEFORE all other middlewares, parsers, and routes
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// 2. Body parsers, compression, and request logging
app.use(compression());
app.use(express.json());
app.use(requestLogger);

// 3. API Routes mapping
app.use('/api/students', studentRoutes);
app.use('/api/contests', contestRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contestmaster', contestmasterRoutes);
app.use('/api/contest', contestLeaderboardSyncRoutes);
app.use('/api/admin/contest', adminContestRoutes);
app.use('/api/placement', placementRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/verification', verificationRoutes);

// API v1 namespace aliases
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/contests', contestRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/departments', departmentRoutes);
app.use('/api/v1/verification', verificationRoutes);
app.use('/api/v1/jobs', jobRoutes);
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/contestmaster', contestmasterRoutes);
app.use('/api/v1/contest', contestLeaderboardSyncRoutes);
app.use('/api/v1/admin/contest', adminContestRoutes);
app.use('/api/v1/placement', placementRoutes);
app.use('/api/v1/ai', aiRoutes);

// Global error handler (must be registered after all route controllers)
app.use(errorHandler);

// Root API
app.get('/', (req, res) => {
  res.send('EnthraHub Faculty Analytics System API is running.');
});

/**
 * Validate database schema on startup — READ ONLY.
 */
async function validateDatabaseSchema() {
  console.log('[Server] Validating database schema compatibility...');
  try {
    const db = require('./config/db');

    let migrationExecuted = false;
    try {
      const rows = await db.query(
        "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'enthrahub_platform_transition'"
      );
      if (rows.length > 0) {
        migrationExecuted = true;
      }
    } catch (err) {
      // Schema_Migrations table might not exist yet
    }

    if (!migrationExecuted) {
      console.warn('======================================================================');
      console.warn('[WARNING] Pending database migrations detected!');
      console.warn('[WARNING] Please run: npm run migrate');
      console.warn('======================================================================');
      return;
    }

    const criticalTables = ['Users', 'Contests', 'Registrations', 'ParticipationLogs', 'AttendanceRecords', 'LeetCodeProfiles'];
    for (const table of criticalTables) {
      try {
        await db.query(`SELECT 1 FROM ${table} LIMIT 1`);
      } catch (err) {
        console.warn(`[WARNING] Missing table: ${table}. Please run: npm run migrate`);
        return;
      }
    }

    console.log('[Server] Database schema is compatible and up to date.');
  } catch (err) {
    console.error('[Server] Database validation error:', err.message);
  }
}

// Database initialization & server start
async function startServer() {
  try {
    await initializeDatabase();
    await validateDatabaseSchema();

    const ContestIntegrityValidator = require('./services/contestIntegrityValidator');
    ContestIntegrityValidator.run().catch(err => {
      console.error('[Server] Contest integrity validation encountered an error:', err.message);
    });

    seedMasterContests().then(res => {
      console.log(`[Server] Background master contest seeding completed: ${res.count} contests processed.`);
    }).catch(err => {
      console.warn('[Server] Background master contest seeding failed (non-critical):', err.message);
    });

    const startupRecovery = require('./services/startupRecovery');
    await startupRecovery.run().catch(err => {
      console.error('[Server] Startup recovery failed:', err.message);
    });

    const liveContestScheduler = require('./services/liveContestScheduler');
    liveContestScheduler.start();

  } catch (err) {
    console.error('[Server] Critical error starting database:', err.message);
  }

  initScheduler();

  app.listen(PORT, () => {
    console.log(`[Server] EnthraHub Faculty Analytics System running on port ${PORT}`);
    console.log(`[Server] API available at /api/`);
    console.log(`[Server] Health check: /api/health`);
  });
}

startServer();
