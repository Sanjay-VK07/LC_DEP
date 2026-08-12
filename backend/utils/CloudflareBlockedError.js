/**
 * utils/CloudflareBlockedError.js
 * ================================
 * Custom error class representing a Cloudflare challenge page or security block.
 */

const DEFAULT_USER_MESSAGE = 'The LeetCode server returned a Cloudflare challenge page instead of contest ranking data. The request was stopped to avoid unnecessary retries. This usually indicates the server environment could not retrieve the ranking data at this time.';

class CloudflareBlockedError extends Error {
  /**
   * @param {string} [message] - Error message describing the block
   * @param {object} [details={}] - Additional metadata regarding the blocked request
   * @param {number} [details.status=403] - HTTP status code
   * @param {string} [details.url] - Request URL
   * @param {string} [details.contestSlug] - Contest slug if applicable
   * @param {number|string} [details.pageNumber] - Page number if applicable
   * @param {object} [details.headers] - Response headers
   * @param {string} [details.bodyPreview] - Truncated snippet of the body (first 300 chars)
   * @param {string} [details.reason] - Reason/type of Cloudflare block
   * @param {string} [details.matchedMarker] - Matched Cloudflare marker signature
   * @param {boolean} [details.isHtml] - Whether HTML markup was detected
   * @param {number} [details.responseSize] - Body length in bytes
   */
  constructor(message = DEFAULT_USER_MESSAGE, details = {}) {
    super(message);
    this.name = 'CloudflareBlockedError';
    this.isCloudflare = true;
    this.code = 'CLOUDFLARE_BLOCK';
    this.status = details.status || 403;
    this.retryable = false;
    this.statusText = details.statusText || (this.status === 403 ? 'Forbidden' : 'Cloudflare Block');
    this.url = details.url || null;
    this.contestSlug = details.contestSlug || 'N/A';
    this.pageNumber = details.pageNumber !== undefined ? details.pageNumber : 'N/A';
    this.timestamp = details.timestamp || new Date().toISOString();
    this.headers = details.headers || {};
    this.bodyPreview = details.bodyPreview || null;
    this.reason = details.reason || 'Cloudflare challenge page';
    this.matchedMarker = details.matchedMarker || 'None';
    this.isHtml = details.isHtml !== undefined ? details.isHtml : true;
    this.responseSize = details.responseSize || 0;
    this.userMessage = DEFAULT_USER_MESSAGE;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CloudflareBlockedError);
    }
  }
}

CloudflareBlockedError.DEFAULT_USER_MESSAGE = DEFAULT_USER_MESSAGE;
module.exports = CloudflareBlockedError;
