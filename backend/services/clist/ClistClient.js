const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Simple In-Memory Cache for CLIST responses with LRU eviction cap
class ClistCache {
  constructor(maxSize = 5000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data, ttlMs) {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs
    });
  }

  clear() {
    this.cache.clear();
  }
}

const memoryCache = new ClistCache();

// Global process-level rate limiter queue to respect 10 requests / minute ceiling (6.5s interval)
let rateLimitQueue = Promise.resolve();
let lastRequestTimestamp = 0;
const MIN_REQUEST_INTERVAL_MS = 6500;

function acquireRateLimitSlot() {
  rateLimitQueue = rateLimitQueue.then(async () => {
    const now = Date.now();
    const elapsed = now - lastRequestTimestamp;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      const waitMs = MIN_REQUEST_INTERVAL_MS - elapsed;
      console.log(`[CLIST RateLimiter] Enforcing ${waitMs}ms delay before next request (global 6.5s spacer)`);
      await new Promise(r => setTimeout(r, waitMs));
    }
    lastRequestTimestamp = Date.now();
  });
  return rateLimitQueue;
}

class ClistClient {
  constructor() {
    this.baseUrl = 'https://clist.by/api/v4';
    this.lastAuthFailed = false;
    this.defaultTtlMs = 10 * 60 * 1000; // 10 minutes cache TTL
    this.contestsTtlMs = 60 * 60 * 1000; // 1 hour cache TTL for contest lists
    this._checkConfiguration();
  }

  _checkConfiguration() {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      console.warn('[CLIST] API key not configured - provider disabled');
      return false;
    }
    return true;
  }

  getApiKey() {
    return process.env.CLIST_API_KEY || null;
  }

  getUsername() {
    return process.env.CLIST_USERNAME || process.env.CLIST_USER || null;
  }

  isConfigured() {
    return !!this.getApiKey();
  }

  getHealth() {
    const configured = this.isConfigured();
    let status = 'disabled';
    if (configured) {
      status = this.lastAuthFailed ? 'unhealthy' : 'healthy';
    }
    return {
      provider: 'clist',
      status,
      configured
    };
  }

  _getAuthHeadersAndParams() {
    const apiKey = this.getApiKey();
    const username = this.getUsername();
    if (!apiKey) return { headers: {}, params: {} };

    const headers = {};
    const params = {};

    if (username) {
      headers['Authorization'] = `ApiKey ${username}:${apiKey}`;
      params['username'] = username;
      params['api_key'] = apiKey;
    } else {
      headers['Authorization'] = `ApiKey ${apiKey}`;
      params['api_key'] = apiKey;
    }

    return { headers, params };
  }

  /**
   * Safe execution wrapper with process-level rate-limiting, retries, exponential backoff, Retry-After handling, and safe logging.
   */
  async _request(endpoint, options = {}, retries = 3) {
    if (!this.isConfigured()) {
      console.warn('[CLIST] API key not configured - provider disabled');
      throw new Error('CLIST provider disabled: CLIST_API_KEY missing');
    }

    const cacheKey = `${endpoint}:${JSON.stringify(options.params || {})}`;
    const ttl = options.ttlMs || this.defaultTtlMs;

    if (!options.bypassCache) {
      const cached = memoryCache.get(cacheKey);
      if (cached) {
        console.log('[CLIST] Cache hit');
        return cached;
      }
    }

    console.log('[CLIST] Cache miss');

    const { headers: authHeaders, params: authParams } = this._getAuthHeadersAndParams();

    const config = {
      url: `${this.baseUrl}${endpoint}`,
      method: options.method || 'GET',
      headers: {
        'Accept': 'application/json',
        ...authHeaders,
        ...(options.headers || {})
      },
      params: {
        ...authParams,
        ...(options.params || {})
      },
      timeout: options.timeout || 15000
    };

    let attempt = 0;
    while (attempt <= retries) {
      attempt++;
      
      // Acquire global rate limit slot before firing HTTP request
      await acquireRateLimitSlot();
      console.log(`[CLIST] Request started: ${endpoint} (Attempt ${attempt}/${retries + 1})`);

      try {
        const response = await axios(config);
        this.lastAuthFailed = false;
        console.log('[CLIST] Contest fetch successful');
        const data = response.data;
        if (!options.bypassCache) {
          memoryCache.set(cacheKey, data, ttl);
        }
        return data;
      } catch (err) {
        const status = err.response ? err.response.status : null;

        if (status === 401 || status === 403) {
          this.lastAuthFailed = true;
          console.error('[CLIST] Authentication failed');
          const authError = new Error(`CLIST Authentication failed (HTTP ${status})`);
          authError.status = status;
          authError.code = 'CLIST_AUTH_FAILED';
          throw authError;
        }

        if (status === 404) {
          console.warn('[CLIST] Resource not found (HTTP 404)');
          return { objects: [], total_count: 0 };
        }

        if (status === 429) {
          console.warn('[CLIST] Rate limited (HTTP 429)');
          const retryAfter = err.response?.headers?.['retry-after'];
          const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, attempt) * 4000;
          console.warn(`[CLIST] Rate limit hit. Backoff ${delayMs}ms (Retry-After header: ${retryAfter || 'N/A'})`);
          
          // Extend lastRequestTimestamp to block subsequent calls during backoff
          lastRequestTimestamp = Date.now() + delayMs;

          if (attempt <= retries) {
            await new Promise(r => setTimeout(r, delayMs));
            continue;
          }
          const rateError = new Error('CLIST Rate limit exceeded (HTTP 429)');
          rateError.status = 429;
          rateError.code = 'CLIST_RATE_LIMITED';
          throw rateError;
        }

        if (attempt <= retries) {
          const delayMs = Math.pow(2, attempt) * 2000;
          console.warn(`[CLIST] Request failed (${err.message}). Retrying in ${delayMs}ms...`);
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }

        // Sanitized error logging (NEVER log API keys or auth headers)
        console.error(`[CLIST] Request failed after ${retries} retries: ${err.message}`);
        throw err;
      }
    }
  }

  /**
   * Retrieve list of contests: GET /api/v4/contest/
   */
  async getContests(options = {}) {
    const params = {
      limit: options.limit || 100,
      offset: options.offset || 0,
      order_by: options.order_by || '-start'
    };
    if (options.resource) params.resource = options.resource;
    if (options.upcoming) params.upcoming = options.upcoming;
    if (options.search) params.search = options.search; // Use search parameter for CLIST API v4
    if (options.event) params.event = options.event;
    if (options.startTimeGte) params.start__gte = options.startTimeGte;
    if (options.startTimeLte) params.start__lte = options.startTimeLte;

    return await this._request('/contest/', { params, ttlMs: this.contestsTtlMs, bypassCache: options.bypassCache });
  }

  /**
   * Retrieve single contest by ID: GET /api/v4/contest/{id}/
   */
  async getContestById(id) {
    if (!id) throw new Error('Contest ID required');
    return await this._request(`/contest/${id}/`, { ttlMs: this.contestsTtlMs });
  }

  /**
   * Retrieve contest statistics/standings: GET /api/v4/statistics/
   * Supports contest_id (numeric) or contest__key
   */
  async getContestParticipants(contestIdentifier, options = {}) {
    if (!contestIdentifier) throw new Error('Contest identifier (ID or key) required');
    
    const params = {
      limit: options.limit || 1000,
      offset: options.offset || 0,
      order_by: options.order_by || 'place'
    };

    // Determine parameter filter: numeric IDs use contest_id
    const isNumericId = /^\d+$/.test(String(contestIdentifier));
    if (isNumericId || options.contest_id) {
      params.contest_id = options.contest_id || contestIdentifier;
    } else {
      params.contest__key = contestIdentifier;
    }

    if (options.resource) params.resource = options.resource;

    return await this._request('/statistics/', { params, ttlMs: this.defaultTtlMs, bypassCache: options.bypassCache });
  }

  /**
   * Retrieve user/account info: GET /api/v4/account/?handle={handle}
   */
  async getUserInfo(handle, resource = null) {
    if (!handle) throw new Error('User handle required');
    const params = { handle };
    if (resource) params.resource = resource;
    return await this._request('/account/', { params, ttlMs: this.defaultTtlMs });
  }

  clearCache() {
    memoryCache.clear();
  }
}

module.exports = new ClistClient();

