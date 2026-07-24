/**
 * Lightweight Orchestration Service for Multi-Platform Verification
 */
const platformRegistry = require('./PlatformRegistry');
const VerificationRepository = require('../repositories/VerificationRepository');
const { getAdapter } = require('./adapters/AdapterFactory');
const {
  ENABLE_PLATFORM_VALIDATION,
  ENABLE_CACHE,
  VALIDATION_POLICY,
  VERIFICATION_CACHE_DAYS,
  MAX_RETRIES,
  RETRY_DELAY_MS
} = require('../config/verificationConfig');
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
    const totalLookups = this.metrics.cacheHits + this.metrics.cacheMisses;
    const cacheHitRate = totalLookups > 0 ? parseFloat(((this.metrics.cacheHits / totalLookups) * 100).toFixed(2)) : 0.00;
    const avgVerificationTimeMs = this.metrics.totalVerifications > 0
      ? Math.round(this.metrics.totalDurationMs / this.metrics.totalVerifications)
      : 0;

    return {
      ...this.metrics,
      cacheHitRate,
      avgVerificationTimeMs
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
      // 1. Check HandleVerifications table
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
          return null; // Triggers fresh verification
        }
      }

      // 2. Backward compatibility fallback: Check Users table
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
    const { retries = MAX_RETRIES, delayMs = RETRY_DELAY_MS, skipCache = false, jobId = null, userId = null } = options;
    const p = (platform || 'leetcode').toLowerCase().trim();

    // Policy DISABLED check
    if (VALIDATION_POLICY === 'DISABLED' || !ENABLE_PLATFORM_VALIDATION) {
      const { original } = PlatformValidator.normalizeUsername(p, username);
      return {
        verified: true,
        status: 'UNVERIFIED',
        username: original,
        source: 'POLICY_DISABLED',
        reason: 'Platform validation disabled by policy'
      };
    }

    const formatRes = PlatformValidator.validateFormat(p, username);
    if (!formatRes.valid) {
      return { verified: false, status: 'INVALID', username: username || '', reason: formatRes.reason };
    }

    const { original, normalized } = PlatformValidator.normalizeUsername(p, formatRes.username);

    // 1. Cache Check
    if (!skipCache) {
      const cached = await PlatformValidator.checkLocalCache(p, original);
      if (cached) {
        this.metrics.cacheHits++;
        this.metrics.totalVerifications++;
        this.metrics.totalDurationMs += (Date.now() - startTime);
        return cached;
      }
      this.metrics.cacheMisses++;
    }

    // 2. Network verification via Adapter
    let lastError = null;
    this.metrics.apiRequests++;

    logEvent('verification_started', { jobId, platform: p, username: original });

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) this.metrics.totalRetries++;

      try {
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

          logEvent('verification_completed', { jobId, platform: p, username: verifiedUsername, status: 'VERIFIED', duration: Date.now() - startTime });
          this.metrics.totalVerifications++;
          this.metrics.totalDurationMs += (Date.now() - startTime);

          return {
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

          this.metrics.apiFailures++;
          logEvent('verification_completed', { jobId, platform: p, username: original, status, duration: Date.now() - startTime, meta: { reason } });
          this.metrics.totalVerifications++;
          this.metrics.totalDurationMs += (Date.now() - startTime);

          return {
            verified: isSoft,
            status,
            username: original,
            usernameNormalized: normalized,
            reason
          };
        }
      } catch (err) {
        lastError = err;
        const msg = err.message || '';
        const isNotFound = msg.includes('not found') || msg.includes('404') || msg.includes('does not exist') || msg.includes('User not found');

        if (isNotFound) {
          const isSoft = VALIDATION_POLICY === 'SOFT';
          const status = isSoft ? 'PENDING' : 'INVALID';

          await VerificationRepository.upsertVerification({
            userId,
            platform: p,
            usernameOriginal: original,
            usernameNormalized: normalized,
            verificationStatus: status,
            verificationSource: 'API',
            lastError: 'Account does not exist'
          });

          this.metrics.apiFailures++;
          this.metrics.totalVerifications++;
          this.metrics.totalDurationMs += (Date.now() - startTime);

          return { verified: isSoft, status, username: original, usernameNormalized: normalized, reason: 'Account does not exist' };
        }

        if (attempt < retries) {
          logEvent('retry', { jobId, platform: p, username: original, meta: { attempt, error: msg } });
          await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
        }
      }
    }

    // All retries failed
    const errMsg = lastError?.message || '';
    const isCloudflare = lastError?.name === 'CloudflareBlockedError' || lastError?.isCloudflare || errMsg.toLowerCase().includes('cloudflare');
    const isRateLimit = lastError?.status === 429 || errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit');
    const isTimeout = lastError?.code === 'ETIMEDOUT' || errMsg.toLowerCase().includes('timeout');

    let reason = 'Unable to verify after retries';
    if (isCloudflare) reason = 'Cloudflare blocked';
    else if (isRateLimit) reason = 'Rate limited';
    else if (isTimeout) reason = 'Verification timeout';

    const isSoft = VALIDATION_POLICY === 'SOFT';
    const status = isSoft ? 'PENDING' : 'FAILED';

    await VerificationRepository.upsertVerification({
      userId,
      platform: p,
      usernameOriginal: original,
      usernameNormalized: normalized,
      verificationStatus: status,
      verificationSource: 'API',
      lastError: reason
    });

    this.metrics.apiFailures++;
    this.metrics.totalVerifications++;
    this.metrics.totalDurationMs += (Date.now() - startTime);

    return { verified: isSoft, status, username: original, usernameNormalized: normalized, reason };
  }

  /**
   * Batch validate usernames concurrently
   */
  async validateBatch(platform, usernames = [], options = {}) {
    const { concurrency = 20, retries = MAX_RETRIES, onProgress = null, skipCache = false, jobId = null } = options;
    const results = new Map();
    const uniqueUsernames = Array.from(new Set(usernames.map(u => (u ? String(u).trim() : '')).filter(Boolean)));

    let completedCount = 0;
    const queue = [...uniqueUsernames];

    const runWorker = async () => {
      while (queue.length > 0) {
        const username = queue.shift();
        if (!username) continue;

        const res = await this.verifySingleUsername(platform, username, { retries, skipCache, jobId });
        const key = res.usernameNormalized || username.toLowerCase();
        results.set(key, res);

        completedCount++;
        if (typeof onProgress === 'function') {
          onProgress(completedCount, uniqueUsernames.length);
        }
      }
    };

    const workerCount = Math.min(concurrency, queue.length);
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(runWorker());
    }

    await Promise.all(workers);
    return { results, metrics: this.getMetrics() };
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
    return VerificationRepository.invalidateCache(platform, normalized);
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
