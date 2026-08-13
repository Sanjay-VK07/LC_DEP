const https = require('https');
const http = require('http');
const { URL } = require('url');

// Environment Variable Configuration
const getApiKey = () => process.env.LEETAI_API_KEY || '';
const getBaseUrl = () => (process.env.LEETAI_API_BASE_URL || 'https://leet.ai/open_api/v1').replace(/\/$/, '');
const getTimeoutMs = () => parseInt(process.env.LEETAI_API_TIMEOUT_MS, 10) || 30000;
const getMaxRetries = () => parseInt(process.env.LEETAI_MAX_RETRIES, 10) || 3;

/**
 * Sanitizes headers and logs to ensure secrets are never leaked.
 */
function sanitizeLog(text) {
  if (!text || typeof text !== 'string') return text;
  const apiKey = getApiKey();
  let sanitized = text;
  if (apiKey) {
    sanitized = sanitized.split(apiKey).join('[REDACTED_API_KEY]');
  }
  return sanitized.replace(/(Authorization:\s*Bearer\s+)[^\s"']+/gi, '$1[REDACTED]');
}

/**
 * Performs a raw HTTP/HTTPS request to Leet.ai API.
 * @param {string} endpoint - Path relative to base URL (e.g. '/problemset/list/')
 * @param {object} options - Request options (method, body, headers, customTimeout)
 * @returns {Promise<{statusCode: number, data: object|array|string, headers: object}>}
 */
function rawRequest(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return reject(new Error('Leet.ai API key is missing. Set LEETAI_API_KEY environment variable.'));
    }

    const baseUrl = getBaseUrl();
    const fullUrl = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    const parsedUrl = new URL(fullUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const method = options.method || 'GET';
    const timeoutMs = options.customTimeout || getTimeoutMs();

    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'CodeTrack-LeetAI-Client/1.0',
      'Authorization': `Bearer ${apiKey}`,
      ...(options.headers || {})
    };

    let postData = '';
    if (options.body) {
      postData = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: method,
      headers: headers,
      timeout: timeoutMs
    };

    const startTime = Date.now();

    const req = httpModule.request(reqOptions, (res) => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        const duration = Date.now() - startTime;
        let parsedData = responseBody;
        let recordCount = 0;

        try {
          if (responseBody) {
            parsedData = JSON.parse(responseBody);
            if (Array.isArray(parsedData)) {
              recordCount = parsedData.length;
            } else if (parsedData && typeof parsedData === 'object') {
              if (Array.isArray(parsedData.data)) recordCount = parsedData.data.length;
              else if (Array.isArray(parsedData.problemset)) recordCount = parsedData.problemset.length;
              else if (Array.isArray(parsedData.participants)) recordCount = parsedData.participants.length;
              else recordCount = 1;
            }
          }
        } catch (_) {
          // Non-JSON response
        }

        resolve({
          statusCode: res.statusCode,
          data: parsedData,
          headers: res.headers,
          duration,
          recordCount
        });
      });
    });

    req.on('error', (err) => {
      const duration = Date.now() - startTime;
      console.error(sanitizeLog(`[LEETAI] Request network error | Duration: ${duration}ms | Error: ${err.message}`));
      reject(new Error(`Leet.ai network error: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      const duration = Date.now() - startTime;
      console.error(`[LEETAI] Request timed out after ${timeoutMs}ms | Endpoint: ${parsedUrl.pathname}`);
      const err = new Error(`Leet.ai API request timed out after ${timeoutMs}ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Executes request with retry logic (exponential backoff with jitter).
 * Does NOT retry on 401 or 403 authentication failures.
 */
async function executeWithRetry(endpoint, options = {}, attempt = 1) {
  const maxRetries = getMaxRetries();
  try {
    const res = await rawRequest(endpoint, options);

    // Check for Auth Errors (401, 403) -> DO NOT RETRY
    if (res.statusCode === 401 || res.statusCode === 403) {
      const errMsg = `Leet.ai API authentication error (HTTP ${res.statusCode}). Check LEETAI_API_KEY configuration.`;
      console.error(`[LEETAI] ${errMsg} [NO RETRY]`);
      const authErr = new Error(errMsg);
      authErr.statusCode = res.statusCode;
      authErr.nonRetryable = true;
      throw authErr;
    }

    // Check for Rate Limit (429) or Server Errors (5xx) -> RETRYABLE
    const isRateLimit = res.statusCode === 429;
    const isServerError = res.statusCode >= 500 && res.statusCode < 600;

    if ((isRateLimit || isServerError) && attempt <= maxRetries) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500), 10000);
      console.warn(`[LEETAI] Retryable status code ${res.statusCode} received (Attempt ${attempt}/${maxRetries}). Retrying in ${backoffMs}ms...`);
      await new Promise(r => setTimeout(r, backoffMs));
      return executeWithRetry(endpoint, options, attempt + 1);
    }

    return res;
  } catch (err) {
    if (err.nonRetryable) throw err;

    const isNetworkOrTimeout = err.code === 'ETIMEDOUT' || err.message.includes('network error') || err.message.includes('timed out');
    if (isNetworkOrTimeout && attempt <= maxRetries) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500), 10000);
      console.warn(`[LEETAI] Network/Timeout error on attempt ${attempt}/${maxRetries}: ${err.message}. Retrying in ${backoffMs}ms...`);
      await new Promise(r => setTimeout(r, backoffMs));
      return executeWithRetry(endpoint, options, attempt + 1);
    }
    throw err;
  }
}

const leetAiClient = {
  /**
   * Check if Leet.ai API is configured with a key.
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(getApiKey() && getApiKey().trim() !== '');
  },

  /**
   * Capability-based check: determines whether Leet.ai currently has a configured / documented contest participant endpoint.
   * Returns false unless process.env.LEETAI_CONTEST_ENDPOINT is explicitly set.
   * @param {string} contestSlug 
   * @returns {boolean}
   */
  hasContestParticipantEndpoint(contestSlug = '') {
    const configuredEndpoint = process.env.LEETAI_CONTEST_ENDPOINT;
    if (configuredEndpoint && configuredEndpoint.trim() !== '') {
      return true;
    }

    // Diagnostic logging when unsupported
    if (contestSlug) {
      console.log(`[LEETAI_CONTEST] Contest: ${contestSlug}`);
      console.log(`[LEETAI_CONTEST] Endpoint: NONE (Unsupported)`);
      console.log(`[LEETAI_CONTEST] HTTP Status: N/A`);
      console.log(`[LEETAI_CONTEST] API Code: N/A`);
      console.log(`[LEETAI_CONTEST] Participants: 0`);
      console.log(`[LEETAI] No supported contest participant endpoint found.`);
      console.log(`[LEETAI] Contest participant synchronization cannot use Leet.ai yet.`);
    }
    return false;
  },

  /**
   * Safe backend diagnostic function to verify Leet.ai connection against documented endpoint.
   * Makes a real request to POST /open_api/v1/problemset/list/
   * @returns {Promise<{success: boolean, statusCode: number, apiCode: number|string, message: string}>}
   */
  async testLeetAiConnection() {
    console.log('[LEETAI] Connection test started');
    if (!this.isConfigured()) {
      console.error('[LEETAI] Key missing. Set LEETAI_API_KEY environment variable.');
      return { success: false, statusCode: 0, apiCode: 1001, message: 'Invalid Secret Key (Missing)' };
    }

    try {
      const res = await executeWithRetry('/problemset/list/', {
        method: 'POST',
        body: { page: 1, limit: 1 }
      });

      console.log(`[LEETAI] HTTP Status: ${res.statusCode}`);

      let apiCode = res.statusCode;
      let message = 'Success';

      if (res.data && typeof res.data === 'object') {
        if (res.data.code !== undefined) apiCode = res.data.code;
        if (res.data.message) message = res.data.message;
        if (res.data.msg) message = res.data.msg;
      }

      // Map documented API response codes
      if (apiCode === 1001 || res.statusCode === 401 || res.statusCode === 403) {
        message = 'Invalid Secret Key';
      } else if (apiCode === 1002 || res.statusCode === 429) {
        message = 'Request frequency exceeded';
      } else if (apiCode === 2000) {
        message = 'Service unavailable on current plan';
      }

      console.log(`[LEETAI] API Code: ${apiCode}`);
      console.log(`[LEETAI] Message: ${message}`);

      const success = res.statusCode === 200 && (apiCode === 200 || apiCode === 0 || apiCode === '200');
      if (success) {
        console.log('[LEETAI] Response received successfully');
      }

      return {
        success,
        statusCode: res.statusCode,
        apiCode,
        message
      };
    } catch (err) {
      console.error(`[LEETAI] Connection test failed: ${err.message}`);
      return {
        success: false,
        statusCode: err.statusCode || 500,
        apiCode: err.statusCode === 401 || err.statusCode === 403 ? 1001 : 500,
        message: err.message
      };
    }
  },

  /**
   * Fetch contest rankings if capability endpoint is configured.
   * @param {string} contestSlug 
   * @returns {Promise<Array<{username: string, rank: number, score: number, finishTime: number, problemsSolved: number}>>}
   */
  async getContestRanking(contestSlug) {
    if (!this.hasContestParticipantEndpoint(contestSlug)) {
      return [];
    }

    const configuredEndpoint = process.env.LEETAI_CONTEST_ENDPOINT.replace('{slug}', contestSlug);
    try {
      const res = await executeWithRetry(configuredEndpoint, { method: 'GET' });
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.participants || []);

      return list.map(item => ({
        username: String(item.username || item.handle || '').trim(),
        rank: Number(item.rank || item.ranking) || null,
        score: Number(item.score) || 0,
        finishTime: Number(item.finishTime || item.finish_time) || 0,
        problemsSolved: Number(item.problemsSolved || item.solved) || 0
      })).filter(p => p.username !== '');
    } catch (err) {
      console.warn(`[LEETAI_CONTEST] Configured endpoint ${configuredEndpoint} failed: ${err.message}`);
      return [];
    }
  }
};

module.exports = leetAiClient;
