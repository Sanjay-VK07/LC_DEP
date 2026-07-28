/**
 * utils/contestRankingCache.js
 * =============================
 * In-memory TTL cache for successful contest ranking API responses.
 * Reduces unnecessary network hits for identical contest/page queries.
 */

class ContestRankingCache {
  constructor() {
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Generates a unique key for contest slug and page number.
   * @param {string} contestSlug 
   * @param {number|string} page 
   * @returns {string}
   */
  _getKey(contestSlug, page) {
    const slug = (contestSlug || '').trim().toLowerCase();
    const pg = page !== undefined ? page : 1;
    return `${slug}:page:${pg}`;
  }

  /**
   * Gets cached page data if available and fresh.
   * 
   * @param {string} contestSlug 
   * @param {number|string} page 
   * @returns {*|null} Cached response or null
   */
  get(contestSlug, page) {
    const key = this._getKey(contestSlug, page);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.data;
  }

  /**
   * Stores ranking response data in cache.
   * 
   * @param {string} contestSlug 
   * @param {number|string} page 
   * @param {*} data 
   * @param {number} [ttlMs] - Optional override for TTL in milliseconds
   */
  set(contestSlug, page, data, ttlMs) {
    if (!data) return;

    const defaultTtl = parseInt(process.env.LEETCODE_CACHE_TTL_MS, 10) || (60 * 60 * 1000); // 1 hour
    const duration = ttlMs !== undefined ? ttlMs : defaultTtl;
    const key = this._getKey(contestSlug, page);

    this.cache.set(key, {
      data,
      cachedAt: Date.now(),
      expiresAt: Date.now() + duration
    });
  }

  /**
   * Checks if a contest page is cached and fresh without modifying hit/miss counts.
   */
  has(contestSlug, page) {
    const key = this._getKey(contestSlug, page);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Invalidates all cache entries for a specific contest slug.
   * @param {string} contestSlug 
   */
  invalidateContest(contestSlug) {
    const prefix = `${(contestSlug || '').trim().toLowerCase()}:page:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clears entire cache.
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses
    };
  }
}

const contestRankingCache = new ContestRankingCache();

module.exports = {
  ContestRankingCache,
  contestRankingCache
};
