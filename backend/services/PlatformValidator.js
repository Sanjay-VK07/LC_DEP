/**
 * Lightweight Orchestration Service for Multi-Platform Verification
 * Refactored Enterprise Edition: Adaptive Token-Bucket Rate Limiting, Circuit Breakers,
 * Stale-While-Revalidate Caching, Correlation Tracing, and Batch Chunking.
 */

const platformRegistry = require('./PlatformRegistry');
const VerificationRepository = require('../repositories/VerificationRepository');
const { getAdapter } = require('./adapters/AdapterFactory');
const {
  ENABLE_PLATFORM_VALIDATION,
  ENABLE_CACHE,
  VALIDATION_POLICY,
  VERIFICATION_CACHE_DAYS,
  VALIDATION_BATCH_SIZE,
  BATCH_DELAY_MS,
  MAX_RETRIES
} = require('../config/verificationConfig');

const { platformScheduler } = require('../utils/platformScheduler');
const { verificationCache } = require('../utils/cacheModule');
const { executeWithRetry } = require('../utils/retryModule');
const { circuitBreaker } = require('../utils/circuitBreaker');
const { logEvent } = require('../utils/verificationLogger');

class PlatformValidator {
  constructor() {
    this.resetMetrics();
  }

  resetMetrics() {
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      apiRequests: 0,
      apiFailures: 0,
      totalRetries: 0,
      totalDurationMs: 0,
      totalVerifications: 0
    };
  }

  getMetrics() {
    const schedulerMetrics = platformScheduler.getOperationalMetrics();
    const cacheStats = verificationCache.getStats();

    const cacheHitRate = cacheStats.hitRate;
    const avgVerificationTimeMs = this.metrics.totalVerifications > 0
      ? Math.round(this.metrics.totalDurationMs / this.metrics.totalVerifications)
      : 0;

    return {
      ...this.metrics,
      cacheHits: this.metrics.cacheHits,
      cacheMisses: this.metrics.cacheMisses,
      cacheHitRate,
      avgVerificationTimeMs,
      scheduler: schedulerMetrics
    };
  }

  /**
   * Normalize username according to platform specification
   */
  static normalizeUsername(platform, username) {
    if (!username || typeof username !== 'string') return { original: '', normalized: '' };
    const original = username.trim();
    const spec = platformRegistry.get(platform);
    const isCaseSensitive = spec ? spec.caseSensitive : false;
    const normalized = isCaseSensitive ? original : original.toLowerCase();
    return { original, normalized };
  }

  /**
   * Validate handle format using registered regex
   */
  static validateFormat(platform, username) {
    if (!username || typeof username !== 'string' || !username.trim()) {
      return { valid: false, reason: 'Username missing' };
    }
    const spec = platformRegistry.get(platform);
    const regex = spec ? spec.regex : /^[a-zA-Z0-9_.-]{3,50}$/;
    const { original } = this.normalizeUsername(platform, username);

    if (!regex.test(original)) {
      return { valid: false, reason: 'Invalid username format' };
    }
    return { valid: true, username: original };
  }

  /**
   * Check local DB HandleVerifications / Users table for previously verified handles
   */
  static async checkLocalCache(platform, username) {
    if (!ENABLE_CACHE) return null;
    const p = (platform || 'leetcode').toLowerCase().trim();
    const { original, normalized } = this.normalizeUsername(p, username);
    if (!normalized) return null;

    try {
      // 1. Check HandleVerifications table directly for expiry verification
      const record = await VerificationRepository.findByPlatformAndUsername(p, normalized);
      if (record) {
        const isVerified = record.verification_status === 'VERIFIED';
        const isExpired = record.verification_expiry && new Date(record.verification_expiry) <= new Date();

        if (isVerified && !isExpired) {
          logEvent('cache_hit', { platform: p, username: original, status: 'VERIFIED' });
          return {
            verified: true,
            status: 'VERIFIED',
            username: record.username_original || original,
            usernameNormalized: normalized,
            source: 'CACHE',
            verifiedAt: record.verified_at,
            verificationExpiry: record.verification_expiry,
            reason: ''
          };
        } else if (isExpired) {
          logEvent('cache_expired', { platform: p, username: original, status: 'EXPIRED' });
          await VerificationRepository.invalidateCache(p, normalized);
          await verificationCache.invalidate(p, original);
          return null; // Triggers fresh verification
        }
      }

      // 2. Memory cache check
      const cacheRes = await verificationCache.get(p, original);
      if (cacheRes && cacheRes.hit && !cacheRes.isStale) {
        logEvent('cache_hit', { platform: p, username: original, status: 'VERIFIED' });
        return { ...cacheRes.data, source: 'CACHE' };
      }

      // 3. DB Users table fallback
      const db = require('../config/db');
      if (p === 'leetcode') {
        const users = await db.query(
          "SELECT leetcode_username FROM Users WHERE LOWER(leetcode_username) = ?",
          [normalized]
        );
        if (users.length > 0) {
          return { verified: true, status: 'VERIFIED', username: users[0].leetcode_username, source: 'DB_USERS', reason: '' };
        }
      } else if (p === 'codeforces') {
        const users = await db.query(
          "SELECT codeforces_username FROM Users WHERE LOWER(codeforces_username) = ? AND codeforces_verified = 1",
          [normalized]
        );
        if (users.length > 0) {
          return { verified: true, status: 'VERIFIED', username: users[0].codeforces_username, source: 'DB_USERS', reason: '' };
        }
      } else if (p === 'codechef') {
        const users = await db.query(
          "SELECT codechef_username FROM Users WHERE LOWER(codechef_username) = ?",
          [normalized]
        );
        if (users.length > 0) {
          return { verified: true, status: 'VERIFIED', username: users[0].codechef_username, source: 'DB_USERS', reason: '' };
        }
      } else if (p === 'hackerrank') {
        const users = await db.query(
          "SELECT hackerrank_username FROM Users WHERE LOWER(hackerrank_username) = ?",
          [normalized]
        );
        if (users.length > 0) {
          return { verified: true, status: 'VERIFIED', username: users[0].hackerrank_username, source: 'DB_USERS', reason: '' };
        }
      }
    } catch (err) {
      console.warn(`[PlatformValidator] Cache check warning for ${original}:`, err.message);
    }
    logEvent('cache_miss', { platform: p, username: original });
    return null;
  }

  /**
   * Main verification method for a single username
   */
  async verifySingleUsername(platform, username, options = {}) {
    const startTime = Date.now();
    const { retries = MAX_RETRIES, skipCache = false, jobId = null, userId = null, staleWhileRevalidate = false } = options;
    const p = (platform || 'leetcode').toLowerCase().trim();
    const verificationId = options.verificationId || `verif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Policy DISABLED check
    if (VALIDATION_POLICY === 'DISABLED' || !ENABLE_PLATFORM_VALIDATION) {
      const { original } = PlatformValidator.normalizeUsername(p, username);
      return {
        verificationId,
        verified: true,
        status: 'UNVERIFIED',
        username: original,
        source: 'POLICY_DISABLED',
        reason: 'Platform validation disabled by policy'
      };
    }

    const formatRes = PlatformValidator.validateFormat(p, username);
    if (!formatRes.valid) {
      return { verificationId, verified: false, status: 'INVALID', username: username || '', reason: formatRes.reason };
    }

    const { original, normalized } = PlatformValidator.normalizeUsername(p, formatRes.username);

    // 1. Cache Check (with Stale-While-Revalidate if requested)
    if (!skipCache) {
      const cachedRes = await verificationCache.get(p, original, { allowStale: staleWhileRevalidate });
      if (cachedRes && cachedRes.hit) {
        this.metrics.cacheHits++;
        this.metrics.totalVerifications++;
        this.metrics.totalDurationMs += (Date.now() - startTime);

        const responseData = { verificationId, ...cachedRes.data, source: 'CACHE' };

        if (cachedRes.isStale && staleWhileRevalidate) {
          logEvent('stale_while_revalidate_triggered', { verificationId, platform: p, username: original });
          setImmediate(() => {
            this.verifySingleUsername(p, original, { ...options, skipCache: true }).catch(err => {
              console.warn(`[PlatformValidator] Background revalidation failed for ${p}:${original}:`, err.message);
            });
          });
        }

        return responseData;
      }
      this.metrics.cacheMisses++;
    }

    // 2. Schedule Request through PlatformScheduler & Execute with Retry
    this.metrics.apiRequests++;
    logEvent('verification_started', { verificationId, jobId, platform: p, username: original });

    try {
      const result = await platformScheduler.schedule(
        p,
        original,
        async () => {
          return executeWithRetry(
            async (attempt) => {
              if (attempt > 1) this.metrics.totalRetries++;

              const spec = platformRegistry.get(p);
              const adapterName = spec ? spec.adapterName : p;
              const adapter = getAdapter(adapterName);
              const profile = await adapter.getProfile(original);

              if (profile && profile.verified) {
                const verifiedAt = new Date();
                const verificationExpiry = new Date(Date.now() + (VERIFICATION_CACHE_DAYS * 24 * 60 * 60 * 1000));
                const verifiedUsername = profile.username || original;

                const record = {
                  userId,
                  platform: p,
                  usernameOriginal: verifiedUsername,
                  usernameNormalized: normalized,
                  verificationStatus: 'VERIFIED',
                  verificationSource: 'API',
                  verifiedAt,
                  verificationExpiry,
                  lastError: null
                };

                await VerificationRepository.upsertVerification(record);

                const data = {
                  verificationId,
                  verified: true,
                  status: 'VERIFIED',
                  username: verifiedUsername,
                  usernameNormalized: normalized,
                  source: 'API',
                  rating: profile.rating || null,
                  verifiedAt,
                  verificationExpiry,
                  reason: ''
                };

                // Populate Cache
                await verificationCache.set(p, original, data);
                return data;
              } else {
                // Explicit platform rejection
                const msg = profile?.message || '';
                let reason = 'Account does not exist';
                if (msg.includes('Cloudflare') || msg.includes('cloudflare')) {
                  reason = 'Cloudflare blocked';
                } else if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
                  reason = 'Rate limited';
                } else if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out')) {
                  reason = 'Verification timeout';
                }

                const isSoft = VALIDATION_POLICY === 'SOFT';
                const status = isSoft ? 'PENDING' : 'INVALID';

                await VerificationRepository.upsertVerification({
                  userId,
                  platform: p,
                  usernameOriginal: original,
                  usernameNormalized: normalized,
                  verificationStatus: status,
                  verificationSource: 'API',
                  verifiedAt: null,
                  verificationExpiry: null,
                  lastError: reason
                });

                const data = {
                  verificationId,
                  verified: isSoft,
                  status,
                  username: original,
                  usernameNormalized: normalized,
                  reason
                };

                if (!isSoft && reason === 'Account does not exist') {
                  await verificationCache.set(p, original, data, 600000); // cache invalid user for 10 min
                }

                return data;
              }
            },
            {
              maxRetries: retries,
              onRetry: (err, attempt, delayMs) => {
                logEvent('retry', { verificationId, jobId, platform: p, username: original, meta: { attempt, delayMs, error: err.message } });
              }
            }
          );
        },
        { verificationId, retryCount: retries, jobId }
      );

      this.metrics.totalVerifications++;
      this.metrics.totalDurationMs += (Date.now() - startTime);
      return { verificationId, ...result };

    } catch (err) {
      this.metrics.apiFailures++;
      this.metrics.totalVerifications++;
      this.metrics.totalDurationMs += (Date.now() - startTime);

      const msg = err.message || '';
      const isNotFound = msg.includes('not found') || msg.includes('404') || msg.includes('does not exist');
      const isCloudflare = err.name === 'CloudflareBlockedError' || err.isCloudflare || msg.toLowerCase().includes('cloudflare');
      const isRateLimit = err.status === 429 || msg.includes('429') || msg.toLowerCase().includes('rate limit');
      const isTimeout = err.code === 'ETIMEDOUT' || msg.toLowerCase().includes('timeout');

      let reason = 'Unable to verify after retries';
      if (isNotFound) reason = 'Account does not exist';
      else if (isCloudflare) reason = 'Cloudflare blocked';
      else if (isRateLimit) reason = 'Rate limited';
      else if (isTimeout) reason = 'Verification timeout';
      else if (err.code === 'QUEUE_FULL') reason = 'Verification queue capacity full';

      const isSoft = VALIDATION_POLICY === 'SOFT';
      const status = isNotFound ? (isSoft ? 'PENDING' : 'INVALID') : (isSoft ? 'PENDING' : 'TEMPORARILY_UNAVAILABLE');

      await VerificationRepository.upsertVerification({
        userId,
        platform: p,
        usernameOriginal: original,
        usernameNormalized: normalized,
        verificationStatus: status,
        verificationSource: 'API',
        lastError: reason
      }).catch(() => {});

      return {
        verificationId,
        verified: false,
        status,
        username: original,
        usernameNormalized: normalized,
        reason
      };
    }
  }

  /**
   * Batch validate handles with Chunking (20 per batch), Inter-Batch Delay, and Progress Reporting.
   */
  async validateBatch(platform, usernames = [], options = {}) {
    const {
      batchSize = VALIDATION_BATCH_SIZE,
      batchDelayMs = BATCH_DELAY_MS,
      retries = MAX_RETRIES,
      onProgress = null,
      skipCache = false,
      jobId = null
    } = options;

    const results = new Map();
    const uniqueUsernames = Array.from(new Set(usernames.map(u => (u ? String(u).trim() : '')).filter(Boolean)));

    let completedCount = 0;
    const totalCount = uniqueUsernames.length;

    // Chunk input into batches of batchSize (e.g. 20)
    for (let i = 0; i < totalCount; i += batchSize) {
      const batch = uniqueUsernames.slice(i, i + batchSize);

      // Submit tasks in current batch independently to PlatformScheduler
      const batchPromises = batch.map(async (username) => {
        const res = await this.verifySingleUsername(platform, username, { retries, skipCache, jobId });
        const key = res.usernameNormalized || username.toLowerCase();
        results.set(key, res);

        completedCount++;
        if (typeof onProgress === 'function') {
          onProgress(completedCount, totalCount);
        }
      });

      await Promise.all(batchPromises);

      // Inter-batch delay
      if (i + batchSize < totalCount && batchDelayMs > 0) {
        await new Promise(r => setTimeout(r, batchDelayMs));
      }
    }

    return { results, metrics: this.getMetrics() };
  }

  /**
   * Verify a student across multiple platforms with Graceful Degradation.
   * If one platform fails, returns partial results with platform-specific errors.
   */
  async verifyStudentMultiPlatform(studentHandles = {}, options = {}) {
    const platformResults = {};
    const platformErrors = {};

    const platforms = Object.keys(studentHandles);
    const verificationPromises = platforms.map(async (platform) => {
      const handle = studentHandles[platform];
      if (!handle) return;

      try {
        const res = await this.verifySingleUsername(platform, handle, options);
        platformResults[platform] = res;
        if (!res.verified) {
          platformErrors[platform] = res.reason || 'Verification failed';
        }
      } catch (err) {
        platformErrors[platform] = err.message || 'Platform verification error';
        platformResults[platform] = {
          verified: false,
          status: 'FAILED',
          username: handle,
          platform,
          reason: platformErrors[platform]
        };
      }
    });

    await Promise.all(verificationPromises);

    return {
      success: Object.keys(platformErrors).length === 0,
      platforms: platformResults,
      errors: platformErrors
    };
  }

  // ==========================================
  // Generic Interface Methods for System Use
  // ==========================================

  async verify(platform, username, options = {}) {
    return this.verifySingleUsername(platform, username, options);
  }

  async verifyBatch(platform, usernames, options = {}) {
    return this.validateBatch(platform, usernames, options);
  }

  async invalidateCache(platform, username) {
    const { normalized } = PlatformValidator.normalizeUsername(platform, username);
    return verificationCache.invalidate(platform, normalized);
  }

  async refreshCache(platform, username) {
    const { normalized } = PlatformValidator.normalizeUsername(platform, username);
    const expiryDate = new Date(Date.now() + (VERIFICATION_CACHE_DAYS * 24 * 60 * 60 * 1000));
    return VerificationRepository.refreshCache(platform, normalized, expiryDate);
  }

  async getVerification(platform, username) {
    const { normalized } = PlatformValidator.normalizeUsername(platform, username);
    return VerificationRepository.findByPlatformAndUsername(platform, normalized);
  }

  async upsertVerification(record) {
    return VerificationRepository.upsertVerification(record);
  }

  // Static backward compatibility wrappers
  static async verifySingleUsername(platform, username, options = {}) {
    const instance = new PlatformValidator();
    return instance.verifySingleUsername(platform, username, options);
  }

  static async validateBatch(platform, usernames = [], options = {}) {
    const instance = new PlatformValidator();
    const batchRes = await instance.validateBatch(platform, usernames, options);
    return batchRes.results;
  }
}

module.exports = PlatformValidator;
