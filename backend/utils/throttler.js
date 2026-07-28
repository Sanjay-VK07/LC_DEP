/**
 * utils/throttler.js
 * ==================
 * Request throttling module to control inter-request delay and worker concurrency.
 * Configurable via environment variables.
 */

class RequestThrottler {
  /**
   * @param {object} [options={}]
   * @param {number} [options.delayMs] - Minimum delay between consecutive requests in ms
   * @param {number} [options.concurrency] - Max active concurrent requests
   */
  constructor(options = {}) {
    this.delayMs = options.delayMs !== undefined
      ? options.delayMs
      : (parseInt(process.env.LEETCODE_PAGE_DELAY_MS || process.env.LEETCODE_THROTTLE_DELAY_MS, 10) || 1000);
    
    // Default concurrency to 2 (max 2 workers for ranking requests)
    const envConcurrency = parseInt(process.env.LEETCODE_PAGE_CONCURRENCY, 10);
    this.concurrency = options.concurrency !== undefined
      ? options.concurrency
      : (Number.isInteger(envConcurrency) && envConcurrency > 0 ? Math.min(2, envConcurrency) : 2);

    this.queue = [];
    this.activeCount = 0;
    this.lastRequestTime = 0;
  }

  /**
   * Configures throttling parameters at runtime.
   * @param {number} delayMs 
   * @param {number} concurrency 
   */
  updateConfig(delayMs, concurrency) {
    if (delayMs !== undefined && delayMs >= 0) this.delayMs = delayMs;
    if (concurrency !== undefined && concurrency > 0) this.concurrency = Math.min(2, concurrency);
  }

  /**
   * Schedules an async task through the throttler queue.
   * 
   * @template T
   * @param {() => Promise<T>} fn 
   * @returns {Promise<T>}
   */
  throttle(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._process();
    });
  }

  async _process() {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const { fn, resolve, reject } = this.queue.shift();
    this.activeCount++;

    // Enforce minimum delay between requests
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.delayMs) {
      const waitTime = this.delayMs - elapsed;
      await new Promise(r => setTimeout(r, waitTime));
    }

    this.lastRequestTime = Date.now();

    try {
      const result = await fn();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.activeCount--;
      this._process();
    }
  }
}

// Export singleton instance as well as Class for custom instantiations
const globalThrottler = new RequestThrottler();

module.exports = {
  RequestThrottler,
  globalThrottler
};
