/**
 * backend/config/platformPolicies.js
 * ===================================
 * Modular Platform-Specific Policies encapsulating Concurrency, Timeout, Cache TTL,
 * Circuit Breaker Settings, and Adaptive Rate Limiting logic per competitive platform.
 */

class BasePlatformPolicy {
  constructor(name, options = {}) {
    this.name = (name || 'generic').toLowerCase().trim();
    this.concurrency = options.concurrency || 2;
    this.initialIntervalMs = options.initialIntervalMs || 1000;
    this.minIntervalMs = options.minIntervalMs || 500;
    this.maxIntervalMs = options.maxIntervalMs || 10000;
    this.currentIntervalMs = this.initialIntervalMs;

    this.timeoutMs = options.timeoutMs || 20000;
    this.cacheTtlSeconds = options.cacheTtlSeconds || (24 * 3600);
    this.failureThreshold = options.failureThreshold || 5;
    this.cooldownMs = options.cooldownMs || 300000; // 5 minutes

    this.consecutiveSuccesses = 0;
  }

  getCurrentIntervalMs() {
    return this.currentIntervalMs;
  }

  /**
   * Adaptive rate limiting: On HTTP 429, back off the request interval.
   */
  on429() {
    this.consecutiveSuccesses = 0;
    const previous = this.currentIntervalMs;
    // Step up interval by 2x or set to minimum 5000ms
    this.currentIntervalMs = Math.min(
      this.maxIntervalMs,
      Math.max(this.currentIntervalMs * 2, 5000)
    );
    console.warn(`[AdaptiveRateLimiter] Adaptive slowdown on platform ${this.name.toUpperCase()}: ${previous}ms -> ${this.currentIntervalMs}ms`);
  }

  /**
   * Adaptive rate limiting: On consistent successes, gradually decrease interval back to baseline.
   */
  onSuccess() {
    this.consecutiveSuccesses++;
    if (this.consecutiveSuccesses >= 5 && this.currentIntervalMs > this.minIntervalMs) {
      const previous = this.currentIntervalMs;
      this.currentIntervalMs = Math.max(
        this.minIntervalMs,
        Math.floor(this.currentIntervalMs * 0.85)
      );
      this.consecutiveSuccesses = 0;
      if (previous !== this.currentIntervalMs) {
        console.log(`[AdaptiveRateLimiter] Adaptive recovery on platform ${this.name.toUpperCase()}: ${previous}ms -> ${this.currentIntervalMs}ms`);
      }
    }
  }

  resetInterval() {
    this.currentIntervalMs = this.initialIntervalMs;
    this.consecutiveSuccesses = 0;
  }
}

class CodeChefPolicy extends BasePlatformPolicy {
  constructor() {
    super('codechef', {
      concurrency: parseInt(process.env.CODECHEF_CONCURRENCY || '2', 10),
      initialIntervalMs: parseInt(process.env.CODECHEF_REQUEST_INTERVAL_MS || '2000', 10),
      minIntervalMs: 1500,
      maxIntervalMs: 12000,
      timeoutMs: parseInt(process.env.CODECHEF_TIMEOUT_MS || '30000', 10),
      cacheTtlSeconds: parseInt(process.env.CODECHEF_CACHE_TTL || String(12 * 3600), 10),
      failureThreshold: parseInt(process.env.CODECHEF_FAILURE_THRESHOLD || '4', 10),
      cooldownMs: parseInt(process.env.CODECHEF_COOLDOWN_MS || '300000', 10)
    });
  }
}

class LeetCodePolicy extends BasePlatformPolicy {
  constructor() {
    super('leetcode', {
      concurrency: parseInt(process.env.LEETCODE_CONCURRENCY || '3', 10),
      initialIntervalMs: parseInt(process.env.LEETCODE_REQUEST_INTERVAL_MS || '500', 10),
      minIntervalMs: 250,
      maxIntervalMs: 5000,
      timeoutMs: parseInt(process.env.LEETCODE_TIMEOUT_MS || '20000', 10),
      cacheTtlSeconds: parseInt(process.env.LEETCODE_CACHE_TTL || String(24 * 3600), 10),
      failureThreshold: parseInt(process.env.LEETCODE_FAILURE_THRESHOLD || '5', 10),
      cooldownMs: parseInt(process.env.LEETCODE_COOLDOWN_MS || '300000', 10)
    });
  }
}

class CodeforcesPolicy extends BasePlatformPolicy {
  constructor() {
    super('codeforces', {
      concurrency: parseInt(process.env.CODEFORCES_CONCURRENCY || '2', 10),
      initialIntervalMs: parseInt(process.env.CODEFORCES_REQUEST_INTERVAL_MS || '1000', 10),
      minIntervalMs: 500,
      maxIntervalMs: 8000,
      timeoutMs: parseInt(process.env.CODEFORCES_TIMEOUT_MS || '20000', 10),
      cacheTtlSeconds: parseInt(process.env.CODEFORCES_CACHE_TTL || String(6 * 3600), 10),
      failureThreshold: parseInt(process.env.CODEFORCES_FAILURE_THRESHOLD || '5', 10),
      cooldownMs: parseInt(process.env.CODEFORCES_COOLDOWN_MS || '300000', 10)
    });
  }
}

class HackerRankPolicy extends BasePlatformPolicy {
  constructor() {
    super('hackerrank', {
      concurrency: parseInt(process.env.HACKERRANK_CONCURRENCY || '1', 10),
      initialIntervalMs: parseInt(process.env.HACKERRANK_REQUEST_INTERVAL_MS || '2000', 10),
      minIntervalMs: 1000,
      maxIntervalMs: 10000,
      timeoutMs: parseInt(process.env.HACKERRANK_TIMEOUT_MS || '30000', 10),
      cacheTtlSeconds: parseInt(process.env.HACKERRANK_CACHE_TTL || String(24 * 3600), 10),
      failureThreshold: parseInt(process.env.HACKERRANK_FAILURE_THRESHOLD || '4', 10),
      cooldownMs: parseInt(process.env.HACKERRANK_COOLDOWN_MS || '300000', 10)
    });
  }
}

class PolicyRegistry {
  constructor() {
    this.policies = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    this.register(new LeetCodePolicy());
    this.register(new CodeChefPolicy());
    this.register(new CodeforcesPolicy());
    this.register(new HackerRankPolicy());
  }

  register(policyInstance) {
    if (!policyInstance || !policyInstance.name) return;
    this.policies.set(policyInstance.name.toLowerCase().trim(), policyInstance);
  }

  get(platformName) {
    if (!platformName) return this.policies.get('leetcode');
    const p = String(platformName).toLowerCase().trim();
    if (!this.policies.has(p)) {
      // Return default policy for unhandled platforms
      const defaultPolicy = new BasePlatformPolicy(p);
      this.policies.set(p, defaultPolicy);
    }
    return this.policies.get(p);
  }
}

const policyRegistry = new PolicyRegistry();

module.exports = {
  BasePlatformPolicy,
  CodeChefPolicy,
  LeetCodePolicy,
  CodeforcesPolicy,
  HackerRankPolicy,
  policyRegistry
};
