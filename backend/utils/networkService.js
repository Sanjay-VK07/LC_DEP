/**
 * utils/networkService.js
 * =======================
 * Reusable portable networking service with persistent HTTP session reuse,
 * Cloudflare challenge detection, zero-retry abort on security blocks,
 * exponential backoff retry for transient errors, throttling, and caching.
 */

const axios = require('axios');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');

const CloudflareBlockedError = require('./CloudflareBlockedError');
const { detectCloudflare } = require('./cloudflareDetector');
const { isRetryableError, executeWithRetry } = require('./retryHelper');
const { globalThrottler } = require('./throttler');
const { contestRankingCache } = require('./contestRankingCache');
const DetailedLogger = require('./detailedLogger');

// Requirement 8: Reuse a single persistent HTTP/HTTPS client session with keep-alive
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

const persistentAxios = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 15000,
  validateStatus: () => true // Resolve for all HTTP statuses to inspect headers/body
});

let curlCapabilities = null;
let capabilityPromise = null;

async function detectCurlCapabilities() {
  if (curlCapabilities) return curlCapabilities;
  if (capabilityPromise) return capabilityPromise;

  capabilityPromise = new Promise((resolve) => {
    exec('curl --version', (err, stdout) => {
      if (err) {
        curlCapabilities = { supported: false, version: 'N/A', protocols: [], features: [], compression: ['gzip', 'deflate'] };
        return resolve(curlCapabilities);
      }
      const raw = stdout || '';
      const lines = raw.split(/\r?\n/);
      const versionLine = lines[0] || '';
      
      const featuresLine = lines.find(l => l.toLowerCase().startsWith('features:')) || '';
      const features = featuresLine ? featuresLine.substring(9).trim().split(/\s+/) : [];
      
      const compression = ['gzip', 'deflate'];
      if (features.some(f => f.toLowerCase() === 'brotli' || f.toLowerCase() === 'br')) {
        compression.push('br');
      }
      
      const verMatch = versionLine.match(/curl\s+([^\s]+)/i);
      const curlVer = verMatch ? verMatch[1] : versionLine.trim();

      curlCapabilities = {
        supported: true,
        version: curlVer,
        features,
        compression,
        raw
      };
      
      resolve(curlCapabilities);
    });
  });

  return capabilityPromise;
}

detectCurlCapabilities().catch(() => {});

function classifyCurlError(err, stdout, stderr) {
  const exitCode = err.code !== undefined ? Number(err.code) : null;
  const stderrStr = (stderr || '').toLowerCase();
  
  if (err.killed || exitCode === 28 || stderrStr.includes('timed out') || stderrStr.includes('timeout')) {
    return { code: 'NETWORK_TIMEOUT', message: 'Connection timed out after 15 seconds' };
  }
  if (exitCode === 127 || stderrStr.includes('not found')) {
    return { code: 'CURL_NOT_FOUND', message: 'curl executable not found in PATH' };
  }
  if (exitCode === 6 || stderrStr.includes('could not resolve host')) {
    return { code: 'DNS_FAILURE', message: 'DNS resolution failed' };
  }
  if (exitCode === 7 || stderrStr.includes('connection refused')) {
    return { code: 'CONNECTION_FAILED', message: 'Failed to connect to host' };
  }
  if (exitCode === 56 || stderrStr.includes('connection reset')) {
    return { code: 'CONNECTION_RESET', message: 'Connection reset by peer' };
  }
  return { code: `CURL_EXIT_CODE_${err.code}`, message: `cURL exited with code ${err.code}: ${stderr || err.message}` };
}

function getHttpStatusText(code) {
  const map = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
  };
  return map[code] || `HTTP ${code}`;
}

class NetworkService {
  /**
   * Helper to build configurable browser-like headers
   * Requirement 9: Configurable browser-like request headers
   */
  static getDefaultHeaders(overrideHeaders = {}) {
    return {
      'User-Agent': process.env.LEETCODE_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': process.env.LEETCODE_ACCEPT || 'application/json, text/plain, */*',
      'Accept-Language': process.env.LEETCODE_ACCEPT_LANGUAGE || 'en-US,en;q=0.9',
      'Referer': process.env.LEETCODE_REFERER || 'https://leetcode.com/contest/',
      'Origin': process.env.LEETCODE_ORIGIN || 'https://leetcode.com',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...overrideHeaders
    };
  }

  /**
   * Parses contest slug and page number from a LeetCode ranking API URL.
   */
  static parseContestAndPage(url) {
    let contestSlug = 'N/A';
    let pageNumber = 1;
    try {
      const match = url.match(/\/ranking\/([^\/]+)\//);
      if (match) contestSlug = match[1];
      const pageMatch = url.match(/pagination=(\d+)/);
      if (pageMatch) pageNumber = parseInt(pageMatch[1], 10);
    } catch (_) {}
    return { contestSlug, pageNumber };
  }

  /**
   * Main HTTP request method.
   * Incorporates caching, Cloudflare detection, exponential retries, throttling, and logging.
   * 
   * @param {string} url 
   * @param {object} [options={}] 
   * @returns {Promise<object>} Parsed JSON response
   */
  static async request(url, options = {}) {
    const { contestSlug, pageNumber } = NetworkService.parseContestAndPage(url);
    const isRankingEndpoint = url.includes('/contest/api/ranking/');
    const bypassCache = !!options.bypassCache;

    // Requirement 10: Cache successful contest ranking pages
    if (isRankingEndpoint && !bypassCache) {
      const cachedData = contestRankingCache.get(contestSlug, pageNumber);
      if (cachedData) {
        DetailedLogger.logRequest({
          url,
          contestSlug,
          pageNumber,
          httpStatus: 200,
          statusText: 'OK (Cached)',
          retryCount: 0,
          errorType: 'NONE',
          durationMs: 0,
          message: 'Serving response from in-memory cache',
          cached: true
        });
        return cachedData;
      }
    }

    const headers = NetworkService.getDefaultHeaders(options.headers);
    const timeout = options.timeout || 15000;
    const useCurlTransport = !!options.useCurlTransport;

    // Wrap request logic inside throttler and retry helper
    return globalThrottler.throttle(async () => {
      return executeWithRetry(
        async (attempt) => {
          const startTime = Date.now();
          const retryCount = attempt - 1;
          try {
            let result;
            if (useCurlTransport) {
              result = await NetworkService.fetchWithCurl(url, headers, timeout, contestSlug, pageNumber);
            } else {
              result = await NetworkService.fetchWithAxios(url, options.method || 'GET', headers, timeout, contestSlug, pageNumber);
            }

            const durationMs = Date.now() - startTime;

            // Cache successful ranking page
            if (isRankingEndpoint) {
              contestRankingCache.set(contestSlug, pageNumber, result, options.cacheTtlMs);
            }

            const responseHeaders = result.headers || {};
            const contentType = responseHeaders['content-type'] || responseHeaders['Content-Type'] || 'application/json';
            const responseSize = JSON.stringify(result).length;

            DetailedLogger.logRequest({
              url,
              contestSlug,
              pageNumber,
              httpStatus: 200,
              statusText: 'OK',
              responseHeaders,
              contentType,
              responseSize,
              bodyPreview: JSON.stringify(result).slice(0, 300),
              isHtml: false,
              matchedMarker: 'None',
              durationMs,
              retryCount,
              errorType: 'NONE',
              message: 'Request successful'
            });

            return result;
          } catch (err) {
            const durationMs = Date.now() - startTime;
            const errorType = (err instanceof CloudflareBlockedError || err.isCloudflare)
              ? 'CLOUDFLARE_BLOCK'
              : (err.code || 'REQUEST_FAILED');

            DetailedLogger.logRequest({
              url,
              contestSlug,
              pageNumber,
              httpStatus: err.status || 'N/A',
              statusText: err.statusText || (err.status ? getHttpStatusText(err.status) : 'N/A'),
              responseHeaders: err.headers || {},
              contentType: err.contentType || (err.headers && (err.headers['content-type'] || err.headers['Content-Type'])) || 'N/A',
              responseSize: err.responseSize || (err.body ? err.body.length : 0),
              bodyPreview: err.bodyPreview || (err.body ? err.body.slice(0, 300) : 'N/A'),
              isHtml: err.isHtml !== undefined ? err.isHtml : (err.body ? err.body.includes('<html') : false),
              matchedMarker: err.matchedMarker || 'None',
              durationMs,
              retryCount,
              errorType,
              message: err.message
            });

            throw err;
          }
        },
        {
          retries: options.retries,
          backoffBaseMs: options.backoffFactor,
          onRetry: (err, attempt, delayMs) => {
            console.warn(`[WARN] Retrying request to ${url} (Attempt ${attempt + 1}) after ${delayMs}ms due to: ${err.message}`);
          }
        }
      );
    });
  }

  /**
   * Axios fetch with Cloudflare detection BEFORE JSON parsing.
   */
  static async fetchWithAxios(url, method, headers, timeout, contestSlug, pageNumber) {
    const config = {
      url,
      method,
      headers,
      timeout,
      responseType: 'text' // Raw text first for safe inspection
    };

    const proxyUrl = process.env.LEETCODE_PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
    if (proxyUrl) {
      try {
        const parsedProxy = new URL(proxyUrl);
        config.proxy = {
          protocol: parsedProxy.protocol.replace(':', ''),
          host: parsedProxy.hostname,
          port: parseInt(parsedProxy.port, 10) || (parsedProxy.protocol === 'https:' ? 443 : 80),
          ...(parsedProxy.username ? { auth: { username: parsedProxy.username, password: parsedProxy.password } } : {})
        };
      } catch (_) {}
    }

    const response = await persistentAxios(config);
    const body = response.data;
    const statusCode = response.status;
    const statusText = response.statusText || getHttpStatusText(statusCode);
    const parsedHeaders = response.headers || {};

    // Requirements 1 & 3: Detect Cloudflare and HTML responses before JSON parsing
    const cfCheck = detectCloudflare({ statusCode, headers: parsedHeaders, body });

    if (cfCheck.isBlocked) {
      const bodyPreview = typeof body === 'string' ? body.slice(0, 300) : null;
      const responseSize = typeof body === 'string' ? Buffer.byteLength(body) : 0;
      const contentType = parsedHeaders['content-type'] || parsedHeaders['Content-Type'] || 'N/A';
      throw new CloudflareBlockedError(
        CloudflareBlockedError.DEFAULT_USER_MESSAGE,
        {
          status: statusCode,
          statusText,
          url,
          contestSlug,
          pageNumber,
          headers: parsedHeaders,
          contentType,
          responseSize,
          bodyPreview,
          reason: cfCheck.reason,
          matchedMarker: cfCheck.matchedMarker,
          isHtml: cfCheck.isHtml
        }
      );
    }

    if (statusCode !== 200) {
      const err = new Error(`Request failed with status code ${statusCode}`);
      err.code = `HTTP_${statusCode}`;
      err.status = statusCode;
      err.statusText = statusText;
      err.headers = parsedHeaders;
      err.body = body;
      throw err;
    }

    try {
      const data = JSON.parse(body);
      Object.defineProperty(data, 'headers', { value: parsedHeaders, enumerable: false, writable: true });
      return data;
    } catch (parseErr) {
      const jsonErr = new Error(`Failed to parse response JSON: ${parseErr.message}`);
      jsonErr.code = 'INVALID_JSON';
      jsonErr.status = statusCode;
      jsonErr.statusText = statusText;
      jsonErr.headers = parsedHeaders;
      jsonErr.body = body;
      throw jsonErr;
    }
  }

  /**
   * cURL CLI fetch method with Cloudflare detection BEFORE JSON parsing.
   */
  static fetchWithCurl(url, headers, timeout, contestSlug, pageNumber) {
    return new Promise((resolve, reject) => {
      let headerFlags = '';
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          const escapedValue = String(value).replace(/"/g, '\\"');
          headerFlags += ` -H "${key}: ${escapedValue}"`;
        }
      }

      let proxyFlag = '';
      const proxyUrl = process.env.LEETCODE_PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
      if (proxyUrl) {
        const escapedProxy = String(proxyUrl).replace(/"/g, '\\"');
        proxyFlag = ` -x "${escapedProxy}"`;
      }
      
      const maxTimeSec = Math.ceil(timeout / 1000);
      const cmd = `curl -i -L -s --compressed --max-time ${maxTimeSec}${proxyFlag}${headerFlags} "${url}"`;

      exec(cmd, { maxBuffer: 30 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
        if (err) {
          const classification = classifyCurlError(err, stdout, stderr);
          const errorObj = new Error(classification.message);
          errorObj.code = classification.code;
          errorObj.status = null;
          errorObj.statusText = 'N/A';
          return reject(errorObj);
        }

        const httpHeaderRegex = /^HTTP\/(?:[0-9\.]+)\s+([0-9]{3})(?:\s+(.*))?/gmi;
        let matches = [...stdout.matchAll(httpHeaderRegex)];
        
        let body = stdout;
        let headersStr = '';

        if (matches.length > 0) {
          const lastMatch = matches[matches.length - 1];
          const headerAndBody = stdout.substring(lastMatch.index);
          const doubleNewlineIndex = headerAndBody.search(/\r?\n\r?\n/);
          
          if (doubleNewlineIndex !== -1) {
            headersStr = headerAndBody.substring(0, doubleNewlineIndex);
            body = headerAndBody.substring(doubleNewlineIndex).replace(/^(\r?\n)+/, '');
          }
        }

        const parsedHeaders = {};
        let statusCode = 200;
        let statusText = 'OK';

        if (headersStr) {
          const lines = headersStr.split(/\r?\n/);
          const httpMatch = lines[0].match(/^HTTP\/(?:[0-9\.]+)\s+([0-9]{3})(?:\s+(.*))?/i);
          if (httpMatch) {
            statusCode = parseInt(httpMatch[1], 10);
            statusText = (httpMatch[2] || '').trim() || getHttpStatusText(statusCode);
          }
          for (let idx = 1; idx < lines.length; idx++) {
            const line = lines[idx];
            const colonIndex = line.indexOf(':');
            if (colonIndex !== -1) {
              const name = line.substring(0, colonIndex).trim().toLowerCase();
              const value = line.substring(colonIndex + 1).trim();
              parsedHeaders[name] = value;
            }
          }
        }

        // Requirements 1 & 3: Detect Cloudflare and HTML responses before JSON parsing
        const cfCheck = detectCloudflare({ statusCode, headers: parsedHeaders, body });

        if (cfCheck.isBlocked) {
          const bodyPreview = typeof body === 'string' ? body.slice(0, 300) : null;
          const responseSize = typeof body === 'string' ? Buffer.byteLength(body) : 0;
          const contentType = parsedHeaders['content-type'] || parsedHeaders['Content-Type'] || 'N/A';
          return reject(new CloudflareBlockedError(
            CloudflareBlockedError.DEFAULT_USER_MESSAGE,
            {
              status: statusCode,
              statusText,
              url,
              contestSlug,
              pageNumber,
              headers: parsedHeaders,
              contentType,
              responseSize,
              bodyPreview,
              reason: cfCheck.reason,
              matchedMarker: cfCheck.matchedMarker,
              isHtml: cfCheck.isHtml
            }
          ));
        }

        if (statusCode !== 200) {
          const httpErr = new Error(`Request failed with status code ${statusCode}`);
          httpErr.code = `HTTP_${statusCode}`;
          httpErr.status = statusCode;
          httpErr.statusText = statusText;
          httpErr.headers = parsedHeaders;
          httpErr.body = body;
          return reject(httpErr);
        }

        try {
          const data = JSON.parse(body);
          Object.defineProperty(data, 'headers', { value: parsedHeaders, enumerable: false, writable: true });
          resolve(data);
        } catch (parseErr) {
          const jsonErr = new Error(`Failed to parse response JSON: ${parseErr.message}`);
          jsonErr.code = 'INVALID_JSON';
          jsonErr.status = statusCode;
          jsonErr.statusText = statusText;
          jsonErr.headers = parsedHeaders;
          jsonErr.body = body;
          reject(jsonErr);
        }
      });
    });
  }

  static normalizeError(err, url) {
    if (err instanceof CloudflareBlockedError || err.name === 'CloudflareBlockedError' || err.isCloudflare) {
      return err;
    }
    const errCode = err.code || 'REQUEST_FAILED';
    const error = new Error(`[${errCode}] ${err.message || 'Request failed'}`);
    error.url = url;
    error.code = errCode;
    error.status = err.status || null;
    return error;
  }
}

NetworkService.CloudflareBlockedError = CloudflareBlockedError;
module.exports = NetworkService;
