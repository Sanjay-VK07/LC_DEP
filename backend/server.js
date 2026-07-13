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


const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Routes mapping — existing routes preserved, new routes added
app.use('/api/students', studentRoutes);
app.use('/api/contests', contestRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/departments', departmentRoutes);

// New routes
app.use('/api/jobs', jobRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contestmaster', contestmasterRoutes);
app.use('/api/contest', contestLeaderboardSyncRoutes);
app.use('/api/placement', placementRoutes);
app.use('/api/ai', aiRoutes);


// API v1 namespace aliases (backward compatible — both /api/ and /api/v1/ work)
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/contests', contestRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/departments', departmentRoutes);
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
 * No ALTER TABLE operations. Only warns about missing migrations.
 */
async function validateDatabaseSchema() {
  console.log('[Server] Validating database schema compatibility...');
  try {
    const db = require('./config/db');

    // Check if Schema_Migrations table exists and migration is recorded
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

    // Check critical tables exist (read-only SELECTs)
    const criticalTables = ['Users', 'Contests', 'Registrations', 'ParticipationLogs', 'AttendanceRecords', 'LeetCodeProfiles'];
    for (const table of criticalTables) {
      try {
        await db.query(`SELECT 1 FROM ${table} LIMIT 1`);
      } catch (err) {
        console.warn(`======================================================================`);
        console.warn(`[WARNING] Missing table: ${table}. Please run: npm run migrate`);
        console.warn(`======================================================================`);
        return;
      }
    }

    // Check AttendanceRecords columns (read-only)
    try {
      const columns = await db.query("SHOW COLUMNS FROM AttendanceRecords");
      const colNames = columns.map(c => c.Field);
      const requiredCols = ['user_id', 'contest_id', 'attendance_status', 'attendance_source'];
      const missing = requiredCols.filter(col => !colNames.includes(col));
      if (missing.length > 0) {
        console.warn(`[WARNING] AttendanceRecords is missing columns: ${missing.join(', ')}. Run: npm run migrate`);
        return;
      }
    } catch (err) {
      console.warn('[Server] Could not validate AttendanceRecords columns:', err.message);
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

    // Non-blocking startup integrity audit for Contest Master
    const ContestIntegrityValidator = require('./services/contestIntegrityValidator');
    ContestIntegrityValidator.run().catch(err => {
      console.error('[Server] Contest integrity validation encountered an error:', err.message);
    });

    // Seed master contests in the background
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

  // Start the automated cron job scheduler
  initScheduler();

  app.listen(PORT, () => {
    console.log(`[Server] EnthraHub Faculty Analytics System running on port ${PORT}`);
    console.log(`[Server] API available at: http://localhost:${PORT}/api/`);
    console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
  });
}

startServer();
