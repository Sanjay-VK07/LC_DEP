/**
 * AnalyticsCacheService
 * =====================
 * Centralised in-memory cache for expensive analytics calculations.
 * - TTL-based expiration (configurable per key)
 * - Automatic invalidation after every successful sync
 * - Manual refresh support
 * - Never serves stale attendance records after a completed sync
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

const cache = new Map(); // key -> { data, expiresAt }
let hits = 0;
let misses = 0;

/**
 * Set a cache entry with an optional TTL (in ms).
 * @param {string} key
 * @param {*} data
 * @param {number} ttlMs
 */
function set(key, data, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
    cachedAt: Date.now()
  });
}

/**
 * Get a cache entry. Returns null if missing or expired.
 * @param {string} key
 * @returns {*|null}
 */
function get(key) {
  const entry = cache.get(key);
  if (!entry) {
    misses++;
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    misses++;
    return null;
  }
  hits++;
  return entry.data;
}

/**
 * Check whether a key exists and is still fresh.
 */
function has(key) {
  const entry = cache.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return false;
  }
  return true;
}

/**
 * Delete a specific cache key.
 */
function invalidate(key) {
  cache.delete(key);
}

/**
 * Delete all keys that match a prefix pattern.
 * @param {string} prefix
 */
function invalidatePrefix(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Invalidate ALL analytics cache entries.
 * Called after every successful sync operation.
 */
function invalidateAll() {
  cache.clear();
  console.log('[CacheService] All analytics cache entries invalidated.');
}

/**
 * Get cache metadata (for monitoring).
 */
function getStats() {
  const now = Date.now();
  const entries = [];
  for (const [key, entry] of cache.entries()) {
    entries.push({
      key,
      cachedAt: new Date(entry.cachedAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
      ttlRemainingMs: Math.max(0, entry.expiresAt - now),
      fresh: now <= entry.expiresAt
    });
  }
  const totalRequests = hits + misses;
  const hitRate = totalRequests > 0 ? ((hits / totalRequests) * 100).toFixed(2) : '0.00';
  return {
    totalEntries: entries.length,
    hits,
    misses,
    hitRate: parseFloat(hitRate),
    entries
  };
}

/**
 * Wrap an async function with cache-aside logic.
 * @param {string} key - Cache key
 * @param {Function} fn - Async function to compute data if cache miss
 * @param {number} ttlMs - TTL in milliseconds
 * @returns {*} Cached or freshly computed data
 */
async function getOrCompute(key, fn, ttlMs = DEFAULT_TTL_MS) {
  const auditLog = require('./auditLogService');
  const cached = get(key);
  if (cached !== null) {
    await auditLog.log('CACHE_HIT', { targetType: 'cache', targetId: key });
    return cached;
  }
  await auditLog.log('CACHE_MISS', { targetType: 'cache', targetId: key });
  const data = await fn();
  set(key, data, ttlMs);
  return data;
}

// Cache key constants for consistency across the application
const KEYS = {
  DASHBOARD_STATS: 'dashboard:stats',
  PORTAL_SUMMARY: 'analytics:portal_summary',
  LEADERBOARDS: (filter) => `analytics:leaderboards:${filter || 'all'}`,
  RATING_DISTRIBUTION: 'analytics:rating_distribution',
  PLATFORM_STATS: 'analytics:platform_stats',
  CONTEST_SUMMARIES: 'contests:summaries',
  STUDENT_ANALYTICS: (id) => `student:analytics:${id}`,
  SYNC_LOGS: 'sync:logs',
  PLACEMENT_STUDENT: (id) => `placement:student:${id}`,
  PLACEMENT_OVERVIEW: (filter) => `placement:overview:${filter || 'all'}`,
  AI_INSIGHTS: (id) => `ai:insights:${id}`,
  DATA_HEALTH: 'student:data_health',
};

module.exports = {
  set,
  get,
  has,
  invalidate,
  invalidatePrefix,
  invalidateAll,
  getStats,
  getOrCompute,
  KEYS
};
