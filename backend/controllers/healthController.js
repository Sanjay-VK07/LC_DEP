/**
 * healthController.js (NEW)
 * ==========================
 * System health: database status, platform API health, memory usage, job queue.
 */

const { getConnectionStatus } = require('../config/db');
const platformHealth = require('../services/platformHealthService');
const jobQueue = require('../services/jobQueueService');
const cache = require('../services/analyticsCacheService');

/**
 * Full system health check.
 */
async function getSystemHealth(req, res) {
  const db = require('../config/db');
  const dbStatus = getConnectionStatus();

  let dbHealthy = false;
  let dbError = null;
  let queryLatencyMs = null;

  if (dbStatus.isConnected) {
    try {
      const start = Date.now();
      await db.query('SELECT 1');
      queryLatencyMs = Date.now() - start;
      dbHealthy = true;
    } catch (err) {
      dbError = err.message;
    }
  } else {
    dbError = dbStatus.lastError ? dbStatus.lastError.message : 'Database pool is offline';
  }

  const mem = process.memoryUsage();
  const runningJobs = jobQueue.listJobs({ status: jobQueue.JOB_STATUS.RUNNING });
  const pendingJobs = jobQueue.listJobs({ status: jobQueue.JOB_STATUS.PENDING });
  const failedJobs = jobQueue.listJobs({ status: jobQueue.JOB_STATUS.FAILED });

  const platformsHealth = platformHealth.getAllPlatformHealth();
  const cacheStats = cache.getStats();

  const uptime = process.uptime();
  const cpuTime = (process.cpuUsage().user + process.cpuUsage().system) / 1000000;
  const cpuPercent = parseFloat(((cpuTime / uptime) * 100).toFixed(2));

  const payload = {
    status: dbHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: Math.round(uptime),
    cpu: {
      usagePercent: cpuPercent,
      processUptimeSeconds: Math.round(uptime)
    },
    database: {
      connected: dbStatus.isConnected,
      connecting: dbStatus.isConnecting,
      retryCount: dbStatus.retryCount,
      healthy: dbHealthy,
      queryLatencyMs,
      error: dbError
    },
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024) + ' MB',
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + ' MB'
    },
    platforms: platformsHealth,
    jobs: {
      running: runningJobs.length,
      pending: pendingJobs.length,
      failed: failedJobs.length,
      recentJobs: jobQueue.listJobs().slice(0, 10)
    },
    cache: cacheStats
  };

  return res.status(dbHealthy ? 200 : 503).json(payload);
}

/**
 * Get platform-specific health.
 */
async function getPlatformHealth(req, res) {
  const { platform } = req.params;
  const health = platform
    ? platformHealth.getPlatformHealth(platform)
    : platformHealth.getAllPlatformHealth();

  if (platform && !health) {
    return res.status(404).json({ success: false, message: `Unknown platform: ${platform}` });
  }

  return res.json({ success: true, data: health });
}

/**
 * Get migration health status.
 */
async function getMigrationHealth(req, res) {
  try {
    const db = require('../config/db');
    const health = await db.query('SELECT * FROM Migration_Health');
    const migrations = await db.query('SELECT * FROM Schema_Migrations ORDER BY executed_at DESC');
    const issues = await db.query('SELECT * FROM Attendance_Migration_Issues LIMIT 50');

    return res.json({
      success: true,
      migrationHealth: health,
      executedMigrations: migrations,
      issues
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve migration health',
      error: err.message
    });
  }
}

/**
 * Get CLIST provider health status.
 */
function getClistHealth(req, res) {
  const ClistClient = require('../services/clist/ClistClient');
  const health = ClistClient.getHealth();
  return res.json(health);
}

module.exports = {
  getSystemHealth,
  getPlatformHealth,
  getMigrationHealth,
  getClistHealth
};
