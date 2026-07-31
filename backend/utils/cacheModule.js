/**
 * backend/utils/cacheModule.js
 * =============================
 * Intelligent Multi-Tier Caching Engine with Stale-While-Revalidate support
 * and platform-specific TTLs (LeetCode: 24h, CodeChef: 12h, Codeforces: 6h, HackerRank: 24h).
 */

const { ENABLE_CACHE, PLATFORM_CACHE_TTL_SECONDS } = require('../config/verificationConfig');
const VerificationRepository = require('../repositories/VerificationRepository');
const { logEvent } = require('./verificationLogger');

class VerificationCacheModule {
  constructor() {
    this.memoryCache = new Map(); // key -> { data, cachedAt, expiresAt }
    this.stats = {
      hits: 0,
      misses: 0,
      staleHits: 0,
      totalLookups: 0
    };
  }

  /**
   * Generates standardized cache key
   */
  getCacheKey(platform, username) {
    const p = (platform || 'leetcode').toLowerCase().trim();
    const u = (username || '').toLowerCase().trim();
    return `${p}:${u}`;
  }

  /**
   * Returns recommended TTL in milliseconds for a platform
   */
  getTtlMs(platform) {
    const p = (platform || 'leetcode').toLowerCase().trim();
    const ttlSec = PLATFORM_CACHE_TTL_SECONDS[p] || (24 * 3600);
    return ttlSec * 1000;
  }

  /**
   * Retrieve cached verification result.
   */
  async get(platform, username, options = {}) {
    if (!ENABLE_CACHE) return null;
    const { allowStale = false } = options;
    this.stats.totalLookups++;

    const key = this.getCacheKey(platform, username);
    const now = Date.now();

    // 1. Check in-memory cache
    if (this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key);
      const isExpired = now >= entry.expiresAt;

      if (!isExpired) {
        this.stats.hits++;
        logEvent('cache_hit', { platform, username, source: 'CACHE' });
        return { data: { ...entry.data, source: 'CACHE' }, hit: true, isStale: false };
      } else if (allowStale) {
        this.stats.staleHits++;
        logEvent('cache_stale', { platform, username, source: 'CACHE_STALE' });
        return { data: { ...entry.data, source: 'CACHE' }, hit: true, isStale: true };
      } else {
        this.memoryCache.delete(key);
      }
    }

    // 2. Check DB HandleVerifications table
    try {
      const p = (platform || 'leetcode').toLowerCase().trim();
      const u = (username || '').toLowerCase().trim();
      const record = await VerificationRepository.findByPlatformAndUsername(p, u);

      if (record) {
        const isVerified = record.verification_status === 'VERIFIED';
        const expiryTime = record.verification_expiry ? new Date(record.verification_expiry).getTime() : 0;
        const isExpired = expiryTime > 0 && expiryTime <= now;

        if (isExpired) {
          logEvent('cache_expired', { platform: p, username, status: 'EXPIRED' });
          await VerificationRepository.invalidateCache(p, u).catch(() => {});
          if (!allowStale) {
            this.stats.misses++;
            return null;
          }
        }

        if (isVerified) {
          const data = {
            verified: true,
            status: 'VERIFIED',
            username: record.username_original || username,
            usernameNormalized: u,
            source: 'CACHE',
            verifiedAt: record.verified_at,
            verificationExpiry: record.verification_expiry,
            reason: ''
          };

          const ttlMs = this.getTtlMs(p);
          this.memoryCache.set(key, {
            data,
            cachedAt: now,
            expiresAt: expiryTime > 0 ? expiryTime : now + ttlMs
          });

          if (!isExpired) {
            this.stats.hits++;
            logEvent('cache_hit', { platform, username, source: 'CACHE' });
            return { data, hit: true, isStale: false };
          } else if (allowStale) {
            this.stats.staleHits++;
            logEvent('cache_stale', { platform, username, source: 'CACHE_STALE' });
            return { data, hit: true, isStale: true };
          }
        }
      }
    } catch (err) {
      console.warn(`[VerificationCacheModule] DB Cache lookup error for ${platform}:${username}:`, err.message);
    }

    this.stats.misses++;
    logEvent('cache_miss', { platform, username });
    return null;
  }

  /**
   * Set cache entry in-memory and update DB
   */
  async set(platform, username, data, customTtlMs = null) {
    if (!ENABLE_CACHE || !data) return;

    const key = this.getCacheKey(platform, username);
    const ttlMs = customTtlMs || this.getTtlMs(platform);
    const now = Date.now();
    const expiresAt = now + ttlMs;

    this.memoryCache.set(key, {
      data: {
        ...data,
        source: 'CACHE'
      },
      cachedAt: now,
      expiresAt
    });

    if (this.memoryCache.size > 10000) {
      const oldestKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(oldestKey);
    }
  }

  /**
   * Invalidate cache entry
   */
  async invalidate(platform, username) {
    const key = this.getCacheKey(platform, username);
    this.memoryCache.delete(key);

    try {
      const p = (platform || 'leetcode').toLowerCase().trim();
      const u = (username || '').toLowerCase().trim();
      await VerificationRepository.invalidateCache(p, u);
    } catch (err) {
      console.warn(`[VerificationCacheModule] DB Cache invalidation warning for ${platform}:${username}:`, err.message);
    }
  }

  /**
   * Retrieve cache operational metrics
   */
  getStats() {
    const hitRate = this.stats.totalLookups > 0
      ? parseFloat(((this.stats.hits / this.stats.totalLookups) * 100).toFixed(2))
      : 0.00;

    return {
      ...this.stats,
      hitRate,
      memorySize: this.memoryCache.size
    };
  }

  resetStats() {
    this.stats = { hits: 0, misses: 0, staleHits: 0, totalLookups: 0 };
    this.memoryCache.clear();
  }
}

// Global Singleton Instance
const verificationCache = new VerificationCacheModule();

module.exports = {
  VerificationCacheModule,
  verificationCache
};
