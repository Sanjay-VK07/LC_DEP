/**
 * utils/detailedLogger.js
 * =======================
 * Structured logging module to record detailed metrics and logs for contest ranking requests and sync jobs.
 */

class DetailedLogger {
  /**
   * Logs a structured record for an HTTP request attempt.
   * 
   * @param {object} info
   * @param {string} info.contestSlug - Contest slug
   * @param {number|string} info.pageNumber - Page number
   * @param {number|string} info.httpStatus - HTTP status code
   * @param {number} info.retryCount - Attempt count / retry index
   * @param {string} info.errorType - Error classification (e.g., CLOUDFLARE_BLOCK, NETWORK_TIMEOUT, NONE)
   * @param {string} [info.timestamp] - ISO timestamp
   * @param {number} [info.durationMs] - Execution time in ms
   * @param {string} [info.message] - Optional message or reason
   * @param {boolean} [info.cached=false] - Whether served from cache
   */
  static logRequest({
    contestSlug = 'N/A',
    pageNumber = 'N/A',
    httpStatus = 'N/A',
    retryCount = 0,
    errorType = 'NONE',
    timestamp = new Date().toISOString(),
    durationMs = 0,
    message = '',
    cached = false
  }) {
    const statusStr = cached ? 'CACHED' : (httpStatus || 'N/A');
    const logLine = `[CONTEST_LOG] timestamp="${timestamp}" contest="${contestSlug}" page=${pageNumber} status=${statusStr} retryCount=${retryCount} errorType="${errorType}" duration=${durationMs}ms message="${message}"`;
    
    if (errorType === 'CLOUDFLARE_BLOCK') {
      console.warn(`\x1b[33m${logLine}\x1b[0m`);
    } else if (errorType !== 'NONE' && errorType !== 'N/A') {
      console.error(`\x1b[31m${logLine}\x1b[0m`);
    } else {
      console.log(`\x1b[32m${logLine}\x1b[0m`);
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
    const durationSec = (totalExecutionTimeMs / 1000).toFixed(2);
    const summaryBox = `
==================================================
              CONTEST SYNC SUMMARY               
==================================================
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
