/**
 * utils/CloudflareBlockedError.js
 * ================================
 * Custom error class representing a Cloudflare challenge page or security block.
 */

class CloudflareBlockedError extends Error {
  /**
   * @param {string} message - Error message describing the block
   * @param {object} [details={}] - Additional metadata regarding the blocked request
   * @param {number} [details.status=403] - HTTP status code
   * @param {string} [details.url] - Request URL
   * @param {string} [details.contestSlug] - Contest slug if applicable
   * @param {number|string} [details.pageNumber] - Page number if applicable
   * @param {object} [details.headers] - Response headers
   * @param {string} [details.bodyPreview] - Truncated snippet of the body
   * @param {string} [details.reason] - Reason/type of Cloudflare block
   */
  constructor(message = 'Cloudflare block detected (Cloudflare challenge page)', details = {}) {
    super(message);
    this.name = 'CloudflareBlockedError';
    this.isCloudflare = true;
    this.code = 'CLOUDFLARE_BLOCK';
    this.status = details.status || 403;
    this.url = details.url || null;
    this.contestSlug = details.contestSlug || 'N/A';
    this.pageNumber = details.pageNumber !== undefined ? details.pageNumber : 'N/A';
    this.timestamp = details.timestamp || new Date().toISOString();
    this.headers = details.headers || {};
    this.bodyPreview = details.bodyPreview || null;
    this.reason = details.reason || 'Cloudflare challenge page';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CloudflareBlockedError);
    }
  }
}

module.exports = CloudflareBlockedError;
