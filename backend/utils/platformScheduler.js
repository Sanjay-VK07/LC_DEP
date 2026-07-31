/**
 * backend/utils/platformScheduler.js
 * ===================================
 * Centralized Per-Platform Request Scheduler featuring:
 * 1. Adaptive Token Bucket Rate Limiting (Policy-driven dynamic intervals)
 * 2. Platform Policy Encapsulation (CodeChefPolicy, LeetCodePolicy, etc.)
 * 3. In-Flight Request Deduplication (Share active Promise for identical concurrent requests)
 * 4. Verification Tracing via Correlation ID (`verificationId`)
 * 5. Queue Capacity & Memory Bounds Protection
 * 6. Graceful Shutdown Draining
 * 7. Operational Metrics Dashboard Data Aggregation
 */

const { VERIFICATION_QUEUE_MAX_SIZE } = require('../config/verificationConfig');
const { policyRegistry } = require('../config/platformPolicies');
const { circuitBreaker } = require('./circuitBreaker');
const { verificationCache } = require('./cacheModule');
const { logEvent } = require('./verificationLogger');

class PlatformScheduler {
  constructor() {
    this.queues = new Map();
    this.activeCounts = new Map();
    this.lastRequestTimes = new Map();
    this.inFlightMap = new Map();
    this.isShuttingDown = false;

    this.metrics = {
      totalRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      deduplicatedRequests: 0,
      count429: 0,
      retryCount: 0,
      timeoutCount: 0,
      rejectedQueueFull: 0,
      totalQueueWaitMs: 0,
      totalRequestDurationMs: 0,
      windowRequests: []
    };

    this._initializePlatforms(['leetcode', 'codechef', 'codeforces', 'hackerrank']);
  }

  _initializePlatforms(platforms) {
    for (const p of platforms) {
      const plat = p.toLowerCase().trim();
      this.queues.set(plat, []);
      this.activeCounts.set(plat, 0);
      this.lastRequestTimes.set(plat, 0);
    }
  }

  getPolicy(platform) {
    return policyRegistry.get(platform);
  }

  getConcurrencyLimit(platform) {
    return this.getPolicy(platform).concurrency;
  }

  getRequestIntervalMs(platform) {
    return this.getPolicy(platform).getCurrentIntervalMs();
  }

  getTimeoutMs(platform) {
    return this.getPolicy(platform).timeoutMs;
  }

  getTotalQueueLength() {
    let total = 0;
    for (const q of this.queues.values()) {
      total += q.length;
    }
    return total;
  }

  /**
   * Schedule an external platform request through the Centralized Scheduler.
   */
  schedule(platform, username, requestFn, options = {}) {
    if (this.isShuttingDown) {
      const err = new Error('Server is shutting down. Verification queue closed.');
      err.status = 503;
      err.code = 'SERVER_SHUTDOWN';
      return Promise.reject(err);
    }

    const p = (platform || 'leetcode').toLowerCase().trim();
    const u = (username || '').toLowerCase().trim();
    const verificationId = options.verificationId || `verif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inFlightKey = `${p}:${u}`;

    // 1. In-Flight Request Deduplication
    if (u && this.inFlightMap.has(inFlightKey)) {
      this.metrics.deduplicatedRequests++;
      logEvent('request_deduplicated', { verificationId, platform: p, username: u });
      return this.inFlightMap.get(inFlightKey);
    }

    // 2. Queue Limit Backpressure Check
    if (this.getTotalQueueLength() >= VERIFICATION_QUEUE_MAX_SIZE) {
      this.metrics.rejectedQueueFull++;
      logEvent('queue_overflow', { verificationId, platform: p, username: u, queueSize: this.getTotalQueueLength() });
      const err = new Error('Verification queue capacity full. Please try again later.');
      err.status = 503;
      err.code = 'QUEUE_FULL';
      return Promise.reject(err);
    }

    if (!this.queues.has(p)) {
      this.queues.set(p, []);
      this.activeCounts.set(p, 0);
      this.lastRequestTimes.set(p, 0);
    }

    // Memory protection on in-flight map size
    if (this.inFlightMap.size > 5000) {
      const firstKey = this.inFlightMap.keys().next().value;
      this.inFlightMap.delete(firstKey);
    }

    // 3. Construct Shared In-Flight Execution Promise
    const promise = new Promise((resolve, reject) => {
      const item = {
        verificationId,
        platform: p,
        username: u,
        requestFn,
        resolve,
        reject,
        queuedAt: Date.now(),
        options
      };

      this.queues.get(p).push(item);
      this._processQueue(p);
    }).finally(() => {
      if (u) this.inFlightMap.delete(inFlightKey);
    });

    if (u) {
      this.inFlightMap.set(inFlightKey, promise);
    }

    return promise;
  }

  /**
   * Internal queue processor per platform
   */
  async _processQueue(platform) {
    const p = platform;
    const policy = this.getPolicy(p);
    const queue = this.queues.get(p);
    const activeCount = this.activeCounts.get(p) || 0;
    const limit = policy.concurrency;

    if (activeCount >= limit || queue.length === 0) {
      return;
    }

    const item = queue.shift();
    if (!item) return;

    this.activeCounts.set(p, activeCount + 1);

    // Enforce Adaptive Token Bucket Rate Limit
    const intervalMs = policy.getCurrentIntervalMs();
    const lastTime = this.lastRequestTimes.get(p) || 0;
    const now = Date.now();
    const elapsed = now - lastTime;

    if (elapsed < intervalMs) {
      const delayMs = intervalMs - elapsed;
      await new Promise(r => setTimeout(r, delayMs));
    }

    this.lastRequestTimes.set(p, Date.now());
    const queueWaitTimeMs = Date.now() - item.queuedAt;
    this.metrics.totalQueueWaitMs += queueWaitTimeMs;

    this.metrics.totalRequests++;
    this.metrics.windowRequests.push(Date.now());
    this._pruneRequestWindow();

    const startTime = Date.now();
    let finalStatus = 'FAILED';
    let httpStatus = 200;
    let cacheHit = false;

    try {
      // Circuit Breaker check
      const result = await circuitBreaker.execute(p, async () => {
        const timeoutMs = policy.timeoutMs;
        let timeoutHandle = null;

        const timeoutPromise = new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            const tErr = new Error(`Verification timed out after ${timeoutMs / 1000}s on ${p}`);
            tErr.code = 'ETIMEDOUT';
            tErr.status = 408;
            this.metrics.timeoutCount++;
            reject(tErr);
          }, timeoutMs);
        });

        try {
          const taskRes = await Promise.race([item.requestFn(), timeoutPromise]);
          return taskRes;
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }
      });

      const durationMs = Date.now() - startTime;
      this.metrics.totalRequestDurationMs += durationMs;
      this.metrics.completedRequests++;

      // Trigger policy success adaptation
      policy.onSuccess();

      finalStatus = result?.status || (result?.verified ? 'VERIFIED' : 'INVALID');
      cacheHit = result?.source === 'CACHE' || result?.source === 'MEMORY_CACHE' || result?.source === 'DB_CACHE';

      this.logAudit({
        verificationId: item.verificationId,
        platform: p,
        username: item.username,
        queueWaitTimeMs,
        requestDurationMs: durationMs,
        retryCount: item.options.retryCount || 0,
        cacheHit,
        httpStatus,
        finalResult: finalStatus
      });

      item.resolve(result);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      this.metrics.totalRequestDurationMs += durationMs;
      this.metrics.failedRequests++;

      httpStatus = err.status || 500;
      if (err.status === 429 || (err.message && err.message.includes('429'))) {
        this.metrics.count429++;
        httpStatus = 429;
        // Trigger policy 429 adaptive slowdown
        policy.on429();
      }

      finalStatus = 'FAILED';

      this.logAudit({
        verificationId: item.verificationId,
        platform: p,
        username: item.username,
        queueWaitTimeMs,
        requestDurationMs: durationMs,
        retryCount: item.options.retryCount || 0,
        cacheHit: false,
        httpStatus,
        finalResult: finalStatus,
        error: err.message
      });

      item.reject(err);
    } finally {
      const currentActive = this.activeCounts.get(p) || 1;
      this.activeCounts.set(p, Math.max(0, currentActive - 1));
      this._processQueue(p);
    }
  }

  _pruneRequestWindow() {
    const oneSecAgo = Date.now() - 1000;
    this.metrics.windowRequests = this.metrics.windowRequests.filter(ts => ts >= oneSecAgo);
  }

  logAudit(auditData) {
    console.log(`[VERIFICATION_AUDIT] VerifID: ${auditData.verificationId || 'N/A'} | Platform: ${auditData.platform} | User: ${auditData.username} | QueueWait: ${auditData.queueWaitTimeMs}ms | Duration: ${auditData.requestDurationMs}ms | Retries: ${auditData.retryCount} | CacheHit: ${auditData.cacheHit} | Status: ${auditData.httpStatus} | Result: ${auditData.finalResult}`);
    logEvent('verification_audit', auditData);
  }

  /**
   * Get Operational Telemetry Metrics
   */
  getOperationalMetrics() {
    this._pruneRequestWindow();
    const requestsPerSec = this.metrics.windowRequests.length;
    const cacheStats = verificationCache.getStats();

    const queueLengthByPlatform = {};
    const currentIntervalByPlatform = {};
    for (const [p, q] of this.queues.entries()) {
      queueLengthByPlatform[p] = q.length;
      currentIntervalByPlatform[p] = this.getPolicy(p).getCurrentIntervalMs();
    }

    const avgResponseTimeMs = (this.metrics.completedRequests + this.metrics.failedRequests) > 0
      ? Math.round(this.metrics.totalRequestDurationMs / (this.metrics.completedRequests + this.metrics.failedRequests))
      : 0;

    const avgQueueWaitMs = this.metrics.totalRequests > 0
      ? Math.round(this.metrics.totalQueueWaitMs / this.metrics.totalRequests)
      : 0;

    return {
      activeQueueLength: this.getTotalQueueLength(),
      queueLengthByPlatform,
      currentIntervalByPlatform,
      requestsPerSec,
      cacheHitRate: cacheStats.hitRate,
      avgResponseTimeMs,
      avgQueueWaitMs,
      totalRequests: this.metrics.totalRequests,
      completedRequests: this.metrics.completedRequests,
      failedRequests: this.metrics.failedRequests,
      deduplicatedRequests: this.metrics.deduplicatedRequests,
      count429: this.metrics.count429,
      retryCount: this.metrics.retryCount,
      timeoutCount: this.metrics.timeoutCount,
      rejectedQueueFull: this.metrics.rejectedQueueFull,
      circuitBreakerState: circuitBreaker.getMetrics()
    };
  }

  /**
   * Graceful Shutdown
   */
  async shutdown() {
    console.log('[PlatformScheduler] Initiating graceful shutdown of verification queue...');
    this.isShuttingDown = true;

    // Reject all pending queued items with HTTP 503
    for (const [p, queue] of this.queues.entries()) {
      while (queue.length > 0) {
        const item = queue.shift();
        const err = new Error('Server shutting down');
        err.status = 503;
        err.code = 'SERVER_SHUTDOWN';
        item.reject(err);
      }
    }

    this.inFlightMap.clear();
    console.log('[PlatformScheduler] Verification queue drained and shutdown complete.');
  }

  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      deduplicatedRequests: 0,
      count429: 0,
      retryCount: 0,
      timeoutCount: 0,
      rejectedQueueFull: 0,
      totalQueueWaitMs: 0,
      totalRequestDurationMs: 0,
      windowRequests: []
    };
    for (const policy of policyRegistry.policies.values()) {
      policy.resetInterval();
    }
  }
}

// Global Singleton Instance
const platformScheduler = new PlatformScheduler();

module.exports = {
  PlatformScheduler,
  platformScheduler
};
