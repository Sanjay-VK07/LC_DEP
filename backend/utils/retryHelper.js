/**
 * utils/retryHelper.js
 * ====================
 * Generic, configurable exponential backoff retry utility with jitter.
 * Immediately aborts retries when a Cloudflare challenge page or security block is detected.
 */

const CloudflareBlockedError = require('./CloudflareBlockedError');

/**
 * Determines whether an error is transient and safe to retry.
 * Returns false immediately for Cloudflare blocks or non-transient failures (e.g. 404).
 * 
 * @param {Error} err 
 * @returns {boolean}
 */
function isRetryableError(err) {
  if (!err) return false;

  // Requirement 5: STOP RETRIES IMMEDIATELY ON CLOUDFLARE BLOCK
  if (
    err instanceof CloudflareBlockedError ||
    err.isCloudflare ||
    err.name === 'CloudflareBlockedError' ||
    err.code === 'CLOUDFLARE_BLOCK'
  ) {
    return false;
  }

  const status = err.status || (err.response && err.response.status);
  const code = err.code || '';

  // Do NOT retry 404 or SSL validation errors
  if (
    status === 404 ||
    code === 'HTTP_404' ||
    code === 'INVALID_CONTEST' ||
    code === 'SSL_ERROR' ||
    code === 'SSL_CERTIFICATE_ERROR' ||
    code === 'CURL_NOT_FOUND' ||
    code === 'UNSUPPORTED_CONTENT_ENCODING'
  ) {
    return false;
  }

  // Safe to retry: 429 rate limit, 5xx server errors, network timeouts, connection reset
  if (
    status === 429 ||
    code === 'HTTP_429' ||
    (status >= 500 && status < 600) ||
    code === 'NETWORK_TIMEOUT' ||
    code === 'DNS_FAILURE' ||
    code === 'CONNECTION_RESET' ||
    code === 'EMPTY_RESPONSE'
  ) {
    return true;
  }

  const message = (err.message || '').toLowerCase();
  if (
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('socket')
  ) {
    return true;
  }

  return false;
}

/**
 * Calculates exponential backoff delay with random jitter.
 * 
 * @param {number} attempt - Current attempt index (1-based)
 * @param {number} backoffBaseMs - Base backoff duration in ms
 * @returns {number} Delay in milliseconds
 */
function calculateBackoffDelay(attempt, backoffBaseMs = 1000) {
  const baseDelay = backoffBaseMs * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 500) + 250;
  return baseDelay + jitter;
}

/**
 * Executes an async function with retry logic, exponential backoff, and immediate abortion on Cloudflare blocks.
 * 
 * @param {Function} fn - Async task function to execute: async (attempt) => result
 * @param {object} [options={}] - Retry options
 * @param {number} [options.retries] - Max retries (defaults to process.env.LEETCODE_MAX_RETRIES || 3)
 * @param {number} [options.backoffBaseMs] - Base backoff in ms (defaults to process.env.LEETCODE_BACKOFF_BASE_MS || 1000)
 * @param {Function} [options.onRetry] - Callback invoked before each retry: (err, attempt, delayMs) => void
 * @returns {Promise<*>} Result of fn
 */
async function executeWithRetry(fn, options = {}) {
  const maxRetries = options.retries !== undefined
    ? options.retries
    : (parseInt(process.env.LEETCODE_MAX_RETRIES, 10) || 3);

  const backoffBaseMs = options.backoffBaseMs !== undefined
    ? options.backoffBaseMs
    : (parseInt(process.env.LEETCODE_BACKOFF_BASE_MS, 10) || 1000);

  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      const canRetry = attempt <= maxRetries && isRetryableError(err);
      if (!canRetry) {
        break;
      }

      const delayMs = calculateBackoffDelay(attempt, backoffBaseMs);
      if (options.onRetry) {
        options.onRetry(err, attempt, delayMs);
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

module.exports = {
  isRetryableError,
  calculateBackoffDelay,
  executeWithRetry
};
