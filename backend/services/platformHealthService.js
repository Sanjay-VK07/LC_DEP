/**
 * PlatformHealthService
 * =====================
 * Tracks per-platform API availability, latency, and failure counts.
 * Used by the system health endpoint and Sync Dashboard.
 */

const db = require('../config/db');

const PLATFORMS = ['leetcode', 'codechef', 'codeforces', 'hackerrank'];

// In-memory health records (synced to DB periodically)
const health = {};
for (const p of PLATFORMS) {
  health[p] = {
    platform: p,
    status: 'unknown',        // 'healthy' | 'degraded' | 'down' | 'unknown'
    successCount: 0,
    failureCount: 0,
    avgLatencyMs: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    consecutiveFailures: 0
  };
}

function _updateAvgLatency(platform, latencyMs) {
  const h = health[platform];
  const n = h.successCount;
  h.avgLatencyMs = n === 0 ? latencyMs : Math.round((h.avgLatencyMs * n + latencyMs) / (n + 1));
}

/**
 * Record a successful API call for a platform.
 * @param {string} platform
 * @param {number} latencyMs - Request duration in milliseconds
 */
function recordSuccess(platform, latencyMs = 0) {
  const h = health[platform.toLowerCase()];
  if (!h) return;
  _updateAvgLatency(platform.toLowerCase(), latencyMs);
  h.successCount++;
  h.consecutiveFailures = 0;
  h.lastSuccessAt = new Date().toISOString();
  h.lastError = null;
  h.status = 'healthy';
}

/**
 * Record a failed API call for a platform.
 * @param {string} platform
 * @param {string} error - Error message
 */
function recordFailure(platform, error = 'Unknown error') {
  const h = health[platform.toLowerCase()];
  if (!h) return;
  h.failureCount++;
  h.consecutiveFailures++;
  h.lastFailureAt = new Date().toISOString();
  h.lastError = String(error).substring(0, 255);

  if (h.consecutiveFailures >= 5) {
    h.status = 'down';
  } else if (h.consecutiveFailures >= 2) {
    h.status = 'degraded';
  } else {
    h.status = 'degraded';
  }
}

/**
 * Get health for a specific platform.
 * @param {string} platform
 */
function getPlatformHealth(platform) {
  return health[platform.toLowerCase()] || null;
}

/**
 * Get health for all platforms.
 */
function getAllPlatformHealth() {
  return Object.values(health);
}

/**
 * Wrap an API call with automatic health tracking.
 * @param {string} platform
 * @param {Function} fn - Async function to wrap
 * @returns {*} Result of fn
 */
async function trackCall(platform, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    recordSuccess(platform, Date.now() - start);
    return result;
  } catch (err) {
    recordFailure(platform, err.message || String(err));
    throw err;
  }
}

/**
 * Reset health counters for a platform (e.g. after configuration change).
 */
function resetHealth(platform) {
  const h = health[platform.toLowerCase()];
  if (!h) return;
  h.successCount = 0;
  h.failureCount = 0;
  h.avgLatencyMs = 0;
  h.lastSuccessAt = null;
  h.lastFailureAt = null;
  h.lastError = null;
  h.consecutiveFailures = 0;
  h.status = 'unknown';
}

/**
 * Persist current health state to DB (called periodically or after sync).
 */
function formatMySQLDate(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function persistHealthToDb() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS PlatformHealth (
        platform VARCHAR(50) PRIMARY KEY,
        status VARCHAR(20) DEFAULT 'unknown',
        success_count INT DEFAULT 0,
        failure_count INT DEFAULT 0,
        avg_latency_ms INT DEFAULT 0,
        consecutive_failures INT DEFAULT 0,
        last_success_at TIMESTAMP NULL,
        last_failure_at TIMESTAMP NULL,
        last_error TEXT DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);

    for (const p of PLATFORMS) {
      const h = health[p];
      await db.query(
        `INSERT INTO PlatformHealth (platform, status, success_count, failure_count, avg_latency_ms, consecutive_failures, last_success_at, last_failure_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           success_count = VALUES(success_count),
           failure_count = VALUES(failure_count),
           avg_latency_ms = VALUES(avg_latency_ms),
           consecutive_failures = VALUES(consecutive_failures),
           last_success_at = VALUES(last_success_at),
           last_failure_at = VALUES(last_failure_at),
           last_error = VALUES(last_error)`,
        [p, h.status, h.successCount, h.failureCount, h.avgLatencyMs, h.consecutiveFailures,
          formatMySQLDate(h.lastSuccessAt), formatMySQLDate(h.lastFailureAt), h.lastError]
      );
    }
  } catch (err) {
    console.warn('[PlatformHealth] Failed to persist health to DB:', err.message);
  }
}

// Persist every 5 minutes
setInterval(() => {
  persistHealthToDb().catch(err => console.warn('[PlatformHealth] Unhandled error during persistence:', err.message));
}, 5 * 60 * 1000);

module.exports = {
  recordSuccess,
  recordFailure,
  getPlatformHealth,
  getAllPlatformHealth,
  trackCall,
  resetHealth,
  persistHealthToDb,
  PLATFORMS
};
