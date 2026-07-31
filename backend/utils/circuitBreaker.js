/**
 * backend/utils/circuitBreaker.js
 * ================================
 * Per-Platform Circuit Breaker Pattern Implementation (CLOSED -> OPEN -> HALF-OPEN).
 * Prevents repeating network calls against failing/rate-limiting external services.
 */

const { CIRCUIT_BREAKER_CONFIG } = require('../config/verificationConfig');
const { logEvent } = require('./verificationLogger');

class PlatformCircuitBreaker {
  constructor(config = {}) {
    this.failureThreshold = config.failureThreshold || CIRCUIT_BREAKER_CONFIG.failureThreshold;
    this.cooldownMs = config.cooldownMs || CIRCUIT_BREAKER_CONFIG.cooldownMs;

    // Platform state store: platform -> { state, consecutiveFailures, lastStateChange, nextProbeTime }
    this.states = new Map();
  }

  /**
   * Internal state retriever / initializer
   */
  _getPlatformState(platform) {
    const p = (platform || 'leetcode').toLowerCase().trim();
    if (!this.states.has(p)) {
      this.states.set(p, {
        platform: p,
        state: 'CLOSED', // CLOSED, OPEN, HALF-OPEN
        consecutiveFailures: 0,
        lastStateChange: Date.now(),
        nextProbeTime: 0,
        totalTrips: 0
      });
    }
    return this.states.get(p);
  }

  /**
   * Checks if the circuit is currently OPEN for a platform.
   * Manages transition from OPEN -> HALF-OPEN after cooldown expires.
   */
  isOpen(platform) {
    const s = this._getPlatformState(platform);
    const now = Date.now();

    if (s.state === 'OPEN') {
      if (now >= s.nextProbeTime) {
        s.state = 'HALF-OPEN';
        s.lastStateChange = now;
        logEvent('circuit_breaker_half_open', { platform: s.platform });
        console.warn(`[CircuitBreaker] Platform ${s.platform} entering HALF-OPEN probe state after cooldown.`);
        return false; // Allow probe request
      }
      return true; // Still OPEN
    }

    return false;
  }

  /**
   * Record a successful request
   */
  recordSuccess(platform) {
    const s = this._getPlatformState(platform);
    if (s.state === 'HALF-OPEN' || s.consecutiveFailures > 0) {
      console.log(`[CircuitBreaker] Platform ${s.platform} recovered. Resetting circuit to CLOSED.`);
      logEvent('circuit_breaker_closed', { platform: s.platform });
    }
    s.state = 'CLOSED';
    s.consecutiveFailures = 0;
  }

  /**
   * Record a failed request (e.g. 429, 5xx, or connection timeout)
   */
  recordFailure(platform, err = null) {
    const s = this._getPlatformState(platform);
    s.consecutiveFailures++;
    const now = Date.now();

    const is429or5xx = err && (err.status === 429 || (err.status >= 500 && err.status < 600) || err.code === 'NETWORK_TIMEOUT');

    if (s.state === 'HALF-OPEN' || (s.state === 'CLOSED' && s.consecutiveFailures >= this.failureThreshold && is429or5xx)) {
      s.state = 'OPEN';
      s.lastStateChange = now;
      s.nextProbeTime = now + this.cooldownMs;
      s.totalTrips++;
      logEvent('circuit_breaker_open', { platform: s.platform, failures: s.consecutiveFailures, cooldownMs: this.cooldownMs });
      console.error(`[CircuitBreaker] TRIPPED CIRCUIT FOR PLATFORM ${s.platform.toUpperCase()} -> OPEN for ${this.cooldownMs / 1000}s due to ${s.consecutiveFailures} consecutive failures.`);
    }
  }

  /**
   * Wraps an async task with circuit breaker state management & fallbacks
   */
  async execute(platform, taskFn, fallbackFn = null) {
    const p = (platform || 'leetcode').toLowerCase().trim();

    if (this.isOpen(p)) {
      logEvent('circuit_breaker_bypassed', { platform: p });
      if (typeof fallbackFn === 'function') {
        return fallbackFn(new Error(`Circuit breaker is OPEN for ${p}`));
      }
      return {
        verified: false,
        status: 'TEMPORARILY_UNAVAILABLE',
        platform: p,
        reason: `Circuit breaker OPEN for ${p}. External platform temporarily disabled.`
      };
    }

    try {
      const result = await taskFn();
      this.recordSuccess(p);
      return result;
    } catch (err) {
      this.recordFailure(p, err);
      if (typeof fallbackFn === 'function') {
        return fallbackFn(err);
      }
      throw err;
    }
  }

  /**
   * Get operational state of all circuit breakers
   */
  getMetrics() {
    const metrics = {};
    for (const [p, s] of this.states.entries()) {
      metrics[p] = {
        state: s.state,
        consecutiveFailures: s.consecutiveFailures,
        totalTrips: s.totalTrips,
        nextProbeTime: s.state === 'OPEN' ? new Date(s.nextProbeTime).toISOString() : null
      };
    }
    return metrics;
  }

  reset() {
    this.states.clear();
  }
}

// Global Singleton Instance
const circuitBreaker = new PlatformCircuitBreaker();

module.exports = {
  PlatformCircuitBreaker,
  circuitBreaker
};
