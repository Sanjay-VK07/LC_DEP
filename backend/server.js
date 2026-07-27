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

const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3001;

// Allowed origin list for production and development
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "https://college-teal-ten.vercel.app",
  process.env.FRONTEND_URL
].filter(Boolean).map(url => url.trim().replace(/\/+$/, ''));

// Production-ready CORS options
const corsOptions = {
  origin(origin, callback) {
    // 1. Allow requests with no origin (curl, postman, same-origin, mobile apps)
    if (!origin) return callback(null, true);

    const cleanOrigin = origin.trim().replace(/\/+$/, '');
    const cleanFrontendUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.trim().replace(/\/+$/, '') : '';

    // 2. Allow all localhost & 127.0.0.1 ports
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleanOrigin);

    // 3. Allow Vercel preview and production deployments (*.vercel.app)
    const isVercelDomain = /\.vercel\.app$/.test(cleanOrigin);

    // 4. Match explicitly configured FRONTEND_URL or allowedOrigins list
    const isConfiguredOrigin = allowedOrigins.includes(cleanOrigin) ||
                               (cleanFrontendUrl && cleanOrigin === cleanFrontendUrl);

    if (isLocalhost || isVercelDomain || isConfiguredOrigin || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    console.warn(`[CORS Audit] Rejected origin: "${origin}"`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 204
};

// 1. Register CORS middleware BEFORE all other middlewares, parsers, and routes
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 2. Explicit OPTIONS short-circuit guard (guarantees preflight requests never reach business logic or throw exceptions)
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// 3. Body parsers and request compression
app.use(compression());
app.use(express.json());
app.use(requestLogger);

// 4. API Routes mapping
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
