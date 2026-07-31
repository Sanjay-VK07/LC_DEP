/**
 * backend/utils/retryModule.js
 * =============================
 * Retry Module with Exponential Backoff + Random Jitter,
 * Retry-After header compliance, and Production Safety Error Filtering.
 */

const { RETRY_BACKOFF_SCHEDULE, RETRY_JITTER_MAX, MAX_RETRIES } = require('../config/verificationConfig');

/**
 * Parses HTTP 'Retry-After' header value if present.
 * Can be seconds (e.g. '120') or HTTP Date (e.g. 'Wed, 21 Oct 2026 07:28:00 GMT').
 * @param {object} headers 
 * @returns {number|null} Duration in milliseconds, or null if invalid/missing
 */
function parseRetryAfterHeader(headers) {
  if (!headers) return null;
  const rawHeader = headers['retry-after'] || headers['Retry-After'];
  if (!rawHeader) return null;

  const valueStr = String(rawHeader).trim();
  // Check if numeric seconds
  if (/^\d+$/.test(valueStr)) {
    const seconds = parseInt(valueStr, 10);
    return seconds > 0 ? seconds * 1000 : null;
  }

  // Try parsing as HTTP Date
  const parsedDate = Date.parse(valueStr);
  if (!isNaN(parsedDate)) {
    const delayMs = parsedDate - Date.now();
    return delayMs > 0 ? delayMs : null;
  }

  return null;
}

/**
 * Determines whether an error is transient and safe to retry.
 * Production Safety Rules:
 * - NEVER retry: 404 Not Found, Invalid Username, User Not Found.
 * - RETRY ONLY: 429 Rate Limit, 500, 502, 503, 504, Network Timeouts, ECONNRESET, ETIMEDOUT.
 * 
 * @param {Error|object} err 
 * @returns {boolean}
 */
function isRetryableError(err) {
  if (!err) return false;

  const status = err.status || (err.response && err.response.status);
  const code = err.code || '';
  const message = (err.message || '').toLowerCase();

  // 1. NON-RETRYABLE FAILURES (Abort immediately)
  if (
    status === 404 ||
    code === 'HTTP_404' ||
    message.includes('404') ||
    message.includes('not found') ||
    message.includes('does not exist') ||
    message.includes('invalid username') ||
    message.includes('user missing') ||
    message.includes('format invalid')
  ) {
    return false;
  }

  // 2. RETRYABLE TRANSIENT FAILURES
  if (
    status === 429 ||
    code === 'HTTP_429' ||
    message.includes('429') ||
    message.includes('too many requests') ||
    message.includes('rate limit') ||
    (status >= 500 && status < 600) ||
    code === 'HTTP_500' ||
    code === 'HTTP_502' ||
    code === 'HTTP_503' ||
    code === 'HTTP_504' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'NETWORK_TIMEOUT' ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('etimedout')
  ) {
    return true;
  }

  return false;
}

/**
 * Calculates exponential backoff delay with random jitter for attempt index.
 * 
 * @param {number} attemptIndex - 0-based attempt index
 * @param {object} headers - HTTP response headers (to check for Retry-After)
 * @returns {number} Delay in milliseconds
 */
function calculateBackoffDelay(attemptIndex, headers = null) {
  // Check Retry-After header first
  const retryAfterMs = parseRetryAfterHeader(headers);
  if (retryAfterMs !== null) {
    console.log(`[RetryModule] Respecting Retry-After header: waiting ${retryAfterMs}ms`);
    return Math.min(retryAfterMs, 30000); // Cap at 30s max wait
  }

  const idx = Math.min(attemptIndex, RETRY_BACKOFF_SCHEDULE.length - 1);
  const baseDelay = RETRY_BACKOFF_SCHEDULE[idx] || 2000;
  const maxJitter = RETRY_JITTER_MAX[idx] || 500;
  const jitter = Math.floor(Math.random() * maxJitter);

  return baseDelay + jitter;
}

/**
 * Executes an async task with retry logic, exponential backoff, jitter, and safety checks.
 * 
 * @param {Function} fn - Task function: async (attempt) => result
 * @param {object} options 
 * @returns {Promise<*>}
 */
async function executeWithRetry(fn, options = {}) {
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : MAX_RETRIES;
  const onRetry = options.onRetry || null;
  const fallback = options.fallback || null;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      const shouldRetry = attempt < maxRetries && isRetryableError(err);
      if (!shouldRetry) {
        break;
      }

      const headers = err.headers || (err.response && err.response.headers);
      const delayMs = calculateBackoffDelay(attempt, headers);

      if (typeof onRetry === 'function') {
        onRetry(err, attempt + 1, delayMs);
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // If fallback object/function is provided, return fallback instead of crashing
  if (fallback !== null) {
    if (typeof fallback === 'function') {
      return fallback(lastError);
    }
    return fallback;
  }

  throw lastError;
}

module.exports = {
  parseRetryAfterHeader,
  isRetryableError,
  calculateBackoffDelay,
  executeWithRetry
};
