/**
 * utils/detailedLogger.js
 * =======================
 * Structured logging module to record detailed metrics and logs for contest ranking requests and sync jobs.
 */

class DetailedLogger {
  /**
   * Logs a comprehensive debug record for an HTTP request attempt.
   * 
   * @param {object} info
   * @param {string} info.url - Request URL
   * @param {string} info.contestSlug - Contest slug
   * @param {number|string} info.pageNumber - Page number
   * @param {number|string} info.httpStatus - HTTP status code
   * @param {object} [info.responseHeaders={}] - Response headers
   * @param {string} [info.contentType='N/A'] - Response Content-Type
   * @param {number} [info.responseSize=0] - Response size in bytes/characters
   * @param {string} [info.bodyPreview='N/A'] - First 300 characters of response body
   * @param {boolean} [info.isHtml=false] - Whether HTML was detected
   * @param {string} [info.matchedMarker='None'] - Matched Cloudflare marker
   * @param {number} [info.durationMs=0] - Request duration in ms
   * @param {number} [info.retryCount=0] - Current attempt / retry count
   * @param {string} [info.errorType='NONE'] - Error classification
   * @param {string} [info.timestamp] - ISO timestamp
   * @param {string} [info.message=''] - Optional message
   * @param {boolean} [info.cached=false] - Whether served from cache
   */
  static logRequest({
    url = 'N/A',
    contestSlug = 'N/A',
    pageNumber = 'N/A',
    httpStatus = 'N/A',
    responseHeaders = {},
    contentType = 'N/A',
    responseSize = 0,
    bodyPreview = 'N/A',
    isHtml = false,
    matchedMarker = 'None',
    durationMs = 0,
    retryCount = 0,
    errorType = 'NONE',
    timestamp = new Date().toISOString(),
    message = '',
    cached = false
  }) {
    const environment = process.env.RENDER ? 'Render' : 'Local';
    const statusStr = cached ? 'CACHED' : (httpStatus || 'N/A');
    const previewSnippet = bodyPreview ? bodyPreview.slice(0, 300).replace(/\r?\n/g, ' ') : 'N/A';
    const headersStr = responseHeaders && Object.keys(responseHeaders).length > 0
      ? JSON.stringify(responseHeaders)
      : 'N/A';

    const debugBlock = `
[DEBUG_REQUEST_LOG]
--------------------------------------------------
Environment:      ${environment}
Timestamp:        ${timestamp}
URL:              ${url}
Contest Slug:     ${contestSlug}
Page Number:      ${pageNumber}
HTTP Status:      ${statusStr}
Content-Type:     ${contentType}
Response Size:    ${responseSize} bytes
Is HTML Detected: ${isHtml}
Matched Marker:   ${matchedMarker || 'None'}
Duration:         ${durationMs}ms
Retry Attempt:    ${retryCount}
Error Type:       ${errorType}
Message:          ${message}
Headers:          ${headersStr}
Body Preview (first 300 chars):
${previewSnippet}
--------------------------------------------------
`;

    if (errorType === 'CLOUDFLARE_BLOCK') {
      console.warn(`\x1b[33m${debugBlock}\x1b[0m`);
    } else if (errorType !== 'NONE' && errorType !== 'N/A') {
      console.error(`\x1b[31m${debugBlock}\x1b[0m`);
    } else {
      console.log(`\x1b[32m${debugBlock}\x1b[0m`);
    }
  }

  /**
   * Formats and prints the final sync summary report.
   * 
   * @param {object} summary
   * @param {string} summary.contestSlug
   * @param {number} summary.totalPagesAttempted
   * @param {number} summary.successfulPages
   * @param {number} summary.cachedPages
   * @param {number} summary.blockedPages
   * @param {number} summary.failedPages
   * @param {number} summary.totalExecutionTimeMs
   */
  static printSyncSummary({
    contestSlug = 'N/A',
    totalPagesAttempted = 0,
    successfulPages = 0,
    cachedPages = 0,
    blockedPages = 0,
    failedPages = 0,
    totalExecutionTimeMs = 0
  }) {
    const environment = process.env.RENDER ? 'Render' : 'Local';
    const durationSec = (totalExecutionTimeMs / 1000).toFixed(2);
    const summaryBox = `
==================================================
              CONTEST SYNC SUMMARY               
==================================================
Environment:           ${environment}
Contest Slug:          ${contestSlug}
Total Pages Attempted: ${totalPagesAttempted}
Successful Pages:      ${successfulPages}
Cached Pages:          ${cachedPages}
Blocked Pages:         ${blockedPages}
Failed Pages:          ${failedPages}
Total Execution Time:  ${durationSec}s (${totalExecutionTimeMs}ms)
==================================================
`;
    console.log(summaryBox);
    return summaryBox;
  }
}

module.exports = DetailedLogger;
