/**
 * utils/networkService.js
 * =======================
 * Reusable portable networking service with transport abstraction, retries,
 * backoff, rate limiting, and error normalization.
 */

const axios = require('axios');
const { exec } = require('child_process');

class CloudflareBlockedError extends Error {
  constructor(message = 'Cloudflare block detected') {
    super(message);
    this.name = 'CloudflareBlockedError';
    this.isCloudflare = true;
  }
}

function isHtmlOrCloudflare(content) {
  if (typeof content !== 'string') return false;
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();
  
  if (
    trimmed.startsWith('<') ||
    lower.includes('<!doctype html>') ||
    lower.includes('<html') ||
    lower.includes('just a moment') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('cf-challenge') ||
    lower.includes('cloudflare') ||
    lower.includes('challenge-platform') ||
    lower.includes('window._cf_chl_opt')
  ) {
    return true;
  }
  return false;
}

let curlCapabilities = null;
let capabilityPromise = null;

async function detectCurlCapabilities() {
  if (curlCapabilities) return curlCapabilities;
  if (capabilityPromise) return capabilityPromise;

  capabilityPromise = new Promise((resolve) => {
    exec('curl --version', (err, stdout, stderr) => {
      if (err) {
        console.warn('[NetworkService] cURL executable not found in PATH or failed to execute:', err.message);
        curlCapabilities = { supported: false, version: 'N/A', protocols: [], features: [], compression: ['gzip', 'deflate'] };
        return resolve(curlCapabilities);
      }
      const raw = stdout || '';
      const lines = raw.split(/\r?\n/);
      const versionLine = lines[0] || '';
      
      const protocolsLine = lines.find(l => l.toLowerCase().startsWith('protocols:')) || '';
      const featuresLine = lines.find(l => l.toLowerCase().startsWith('features:')) || '';
      
      const features = featuresLine ? featuresLine.substring(9).trim().split(/\s+/) : [];
      const protocols = protocolsLine ? protocolsLine.substring(10).trim().split(/\s+/) : [];
      
      // Extract SSL backend
      let sslBackend = 'Unknown';
      const sslMatch = versionLine.match(/libcurl\/[^\s]+\s+([^\s]+)/i);
      if (sslMatch) {
        sslBackend = sslMatch[1];
      }

      // Determine compression support
      const compression = ['gzip', 'deflate'];
      if (features.some(f => f.toLowerCase() === 'brotli' || f.toLowerCase() === 'br')) {
        compression.push('br');
      }
      if (features.some(f => f.toLowerCase() === 'zstd')) {
        compression.push('zstd');
      }
      
      curlCapabilities = {
        supported: true,
        version: versionLine.trim(),
        sslBackend,
        features,
        protocols,
        compression,
        raw
      };
      
      console.log(`
=== [NetworkService Startup Diagnostics] ===
cURL Version: ${curlCapabilities.version}
SSL Backend: ${curlCapabilities.sslBackend}
Supported Protocols: ${protocols.join(', ')}
Supported Features: ${features.join(', ')}
Supported Compression: ${compression.join(', ')}
============================================
`);
      resolve(curlCapabilities);
    });
  });

  return capabilityPromise;
}

// Trigger capability check on startup asynchronously
detectCurlCapabilities().catch(err => console.error('[NetworkService] Failed to detect cURL capabilities:', err));

function classifyCurlError(err, stdout, stderr) {
  const code = err.code;
  const stderrStr = (stderr || '').toLowerCase();
  
  if (err.killed || code === 28 || stderrStr.includes('timed out') || stderrStr.includes('timeout')) {
    return { code: 'NETWORK_TIMEOUT', message: 'Connection timed out after 15 seconds' };
  }
  if (code === 127 || stderrStr.includes('not found') || stderrStr.includes('not recognized')) {
    return { code: 'CURL_NOT_FOUND', message: 'curl executable not found in PATH' };
  }
  if (code === 6 || stderrStr.includes('could not resolve host') || stderrStr.includes('resolve')) {
    return { code: 'DNS_FAILURE', message: 'DNS resolution failed' };
  }
  if (code === 7 || stderrStr.includes('connection refused') || stderrStr.includes('failed to connect')) {
    return { code: 'CONNECTION_FAILED', message: 'Failed to connect to host (connection refused)' };
  }
  if (code === 35 || stderrStr.includes('tls handshake') || stderrStr.includes('handshake failed')) {
    return { code: 'TLS_HANDSHAKE_FAILED', message: 'TLS handshake failed' };
  }
  if (code === 47 || stderrStr.includes('redirect loop') || stderrStr.includes('too many redirects')) {
    return { code: 'REDIRECT_LOOP', message: 'Maximum redirect limit exceeded (redirect loop)' };
  }
  if (code === 51 || stderrStr.includes('ssl certificate') || stderrStr.includes('peer certificate')) {
    return { code: 'SSL_CERTIFICATE_ERROR', message: 'SSL certificate validation failed' };
  }
  if (code === 52 || stderrStr.includes('empty response') || stderrStr.includes('returned nothing')) {
    return { code: 'EMPTY_RESPONSE', message: 'Server returned nothing (empty response)' };
  }
  if (code === 56 || stderrStr.includes('connection reset') || stderrStr.includes('recv failure')) {
    return { code: 'CONNECTION_RESET', message: 'Connection reset by peer' };
  }
  if (code === 60 || stderrStr.includes('certificate verify') || stderrStr.includes('ca cert')) {
    return { code: 'SSL_CERTIFICATE_VERIFY_FAILED', message: 'TLS certificate verification failed' };
  }
  if (code === 61 || stderrStr.includes('unrecognized transfer encoding') || stderrStr.includes('bad content encoding') || stderrStr.includes('unrecognized content encoding')) {
    return { code: 'UNSUPPORTED_CONTENT_ENCODING', message: 'Unrecognized content or transfer encoding (cURL failed to decompress response - possibly unsupported Brotli/br compression)' };
  }
  return { code: `CURL_EXIT_CODE_${code}`, message: `cURL exited with code ${code}: ${stderr || err.message}` };
}

function isRetryableError(err) {
  const code = err.code || '';
  const status = err.status || (err.response && err.response.status);

  // Do NOT retry 404
  if (status === 404 || code === 'HTTP_404' || code === 'INVALID_CONTEST') {
    return false;
  }

  // Do NOT retry SSL certificate failures, missing cURL bin, or unsupported encoding errors
  if (
    code === 'SSL_ERROR' ||
    code === 'SSL_CERTIFICATE_ERROR' ||
    code === 'SSL_CERTIFICATE_VERIFY_FAILED' ||
    code === 'CURL_NOT_FOUND' ||
    code === 'UNSUPPORTED_CONTENT_ENCODING'
  ) {
    return false;
  }

  // Retry 403 (Cloudflare block)
  if (status === 403 || code === 'HTTP_403' || code === 'CLOUDFLARE_BLOCK') {
    return true;
  }

  // Retry 429
  if (status === 429 || code === 'HTTP_429') {
    return true;
  }

  // Retry server errors
  if (status >= 500 && status < 600) {
    return true;
  }

  // Retry timeouts, DNS temporary failure, Connection reset
  if (
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

class NetworkService {
  static printRichLog({
    requestId,
    contest,
    page,
    url,
    workerId,
    attempt,
    cmd,
    exitCode,
    status,
    duration,
    stdout,
    stderr,
    headers,
    body,
    retryDecision
  }) {
    console.log(`
==================================================
Request ID: ${requestId}
Contest: ${contest}
Page: ${page}
URL: ${url}
Worker ID: ${workerId || 'Main'}
Attempt: ${attempt}
Curl Command: ${cmd || 'N/A'}
Exit Code: ${exitCode !== null ? exitCode : '0'}
HTTP Status: ${status || 'N/A'}
Duration: ${duration}ms
stdout: ${stdout ? (stdout.length > 500 ? stdout.slice(0, 500) + '...' : stdout) : 'N/A'}
stderr: ${stderr || 'N/A'}
Headers: ${headers ? JSON.stringify(headers, null, 2) : 'N/A'}
Body Preview (first 500 chars):
${body ? body.slice(0, 500) : 'N/A'}
Retry Decision: ${retryDecision}
==================================================
`);
  }

  /**
   * Performs an HTTP request with retry logic, backoff, and transport abstraction.
   */
  static async request(url, options = {}) {
    const requestId = `REQ-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    const method = (options.method || 'GET').toUpperCase();

    const capabilities = await detectCurlCapabilities();
    let acceptEncoding = 'gzip, deflate';
    if (capabilities && capabilities.compression) {
      acceptEncoding = capabilities.compression.join(', ');
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': acceptEncoding,
      'Referer': 'https://leetcode.com/contest/',
      'Origin': 'https://leetcode.com',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...options.headers
    };
    const timeout = options.timeout || 15000;
    
    // Parse contest slug and page from URL
    let contest = 'N/A';
    let page = 'N/A';
    try {
      const match = url.match(/\/ranking\/([^\/]+)\//);
      if (match) contest = match[1];
      const pageMatch = url.match(/pagination=(\d+)/);
      if (pageMatch) page = pageMatch[1];
    } catch (_) {}

    const maxRetries = options.retries !== undefined 
      ? options.retries 
      : (parseInt(process.env.LEETCODE_MAX_RETRIES, 10) || 4);
    const backoffBase = options.backoffFactor !== undefined 
      ? options.backoffFactor 
      : (parseInt(process.env.LEETCODE_BACKOFF_BASE_MS, 10) || 2000);
      
    const useCurlTransport = !!options.useCurlTransport;
    const workerId = options.workerId || 'Main';

    let lastError;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      if (options.onRequestAttempt) {
        await options.onRequestAttempt(attempt);
      }

      const attemptStartTime = Date.now();
      try {
        let result;
        if (useCurlTransport) {
          result = await this.fetchWithCurl(url, headers, timeout);
        } else {
          result = await this.fetchWithAxios(url, method, headers, timeout);
        }

        const duration = Date.now() - attemptStartTime;
        
        // Log success
        this.printRichLog({
          requestId,
          contest,
          page,
          url,
          workerId,
          attempt,
          cmd: result.cmd || (useCurlTransport ? 'curl' : 'axios'),
          exitCode: 0,
          status: 200,
          duration,
          stdout: JSON.stringify(result),
          stderr: '',
          headers: result.headers || { 'content-type': 'application/json' },
          body: JSON.stringify(result),
          retryDecision: 'SUCCESS (No Retry Required)'
        });

        return result;
      } catch (err) {
        lastError = err;
        const duration = Date.now() - attemptStartTime;
        const willRetry = attempt <= maxRetries && isRetryableError(err);
        const retryDecision = willRetry ? 'RETRY (Will retry after delay)' : 'ABORT (Non-retryable error)';

        // Log failure
        this.printRichLog({
          requestId,
          contest,
          page,
          url,
          workerId,
          attempt,
          cmd: err.cmd || (useCurlTransport ? 'curl' : 'axios'),
          exitCode: err.exitCode !== undefined ? err.exitCode : (err.code ? err.code : null),
          status: err.status || null,
          duration,
          stdout: err.stdout || null,
          stderr: err.stderr || err.message,
          headers: err.headers || {},
          body: err.body || null,
          retryDecision
        });

        const isCloudflare = err instanceof CloudflareBlockedError || err.isCloudflare || err.code === 'CLOUDFLARE_BLOCK';
        if (isCloudflare) {
          console.warn(`[WARN] Cloudflare blocked page request to: ${url}`);
        } else {
          console.warn(`[WARN] Attempt ${attempt} failed for: ${url} - ${err.message}`);
        }

        if (willRetry) {
          // Exponential backoff with random jitter
          const baseDelay = backoffBase * Math.pow(2, attempt - 1);
          // Jitter of 250ms to 750ms
          const jitter = Math.floor(Math.random() * 500) + 250;
          const delay = baseDelay + jitter;
          
          console.warn(`[WARN] Retrying page request to: ${url} (Attempt ${attempt + 1}) after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }

    throw this.normalizeError(lastError, url);
  }

  /**
   * Standard Axios fetch method. Requests text first, validates, and parses.
   */
  static async fetchWithAxios(url, method, headers, timeout) {
    const config = {
      url,
      method,
      headers,
      timeout,
      responseType: 'text', // Request raw text first
      validateStatus: () => true // Resolve for any status code so we can inspect headers/body
    };

    const response = await axios(config);
    const contentType = response.headers['content-type'] || '';
    const body = response.data;

    // Parse Axios headers into normalized headers format
    const parsedHeaders = {
      httpVersion: '1.1',
      statusCode: response.status,
      ...response.headers
    };

    if (isHtmlOrCloudflare(body)) {
      let reason = 'Cloudflare block detected';
      const lowerBody = body.toLowerCase();
      if (lowerBody.includes('access denied')) {
        reason = 'Access Denied';
      } else if (lowerBody.includes('captcha')) {
        reason = 'Captcha verification required';
      } else if (lowerBody.includes('maintenance')) {
        reason = 'Maintenance page';
      } else if (lowerBody.includes('login') || lowerBody.includes('signin')) {
        reason = 'Redirected to login page';
      } else if (lowerBody.includes('just a moment') || lowerBody.includes('cf-challenge')) {
        reason = 'Cloudflare challenge page';
      }
      
      const cfErr = new CloudflareBlockedError(`Cloudflare block detected (${reason}) for URL: ${url}`);
      cfErr.code = 'CLOUDFLARE_BLOCK';
      cfErr.status = response.status;
      cfErr.headers = parsedHeaders;
      cfErr.body = body;
      throw cfErr;
    }

    if (contentType && !contentType.toLowerCase().includes('application/json')) {
      const cTypeErr = new Error(`Invalid content-type: "${contentType}". Expected "application/json".`);
      cTypeErr.code = 'INVALID_JSON';
      cTypeErr.status = response.status;
      cTypeErr.headers = parsedHeaders;
      cTypeErr.body = body;
      throw cTypeErr;
    }

    if (response.status !== 200) {
      let errCode = `HTTP_${response.status}`;
      if (response.status === 404) {
        errCode = 'HTTP_404';
      } else if (response.status === 403) {
        errCode = 'HTTP_403';
      } else if (response.status === 429) {
        errCode = 'HTTP_429';
      }
      const err = new Error(`Request failed with status code ${response.status}`);
      err.code = errCode;
      err.status = response.status;
      err.headers = parsedHeaders;
      err.body = body;
      throw err;
    }

    try {
      const data = JSON.parse(body);
      Object.defineProperty(data, 'cmd', { value: 'axios', enumerable: false, writable: true });
      Object.defineProperty(data, 'headers', { value: parsedHeaders, enumerable: false, writable: true });
      return data;
    } catch (parseErr) {
      const jsonErr = new Error(`Failed to parse response JSON: ${parseErr.message}`);
      jsonErr.code = 'INVALID_JSON';
      jsonErr.status = response.status;
      jsonErr.headers = parsedHeaders;
      jsonErr.body = body;
      throw jsonErr;
    }
  }

  /**
   * CLI curl fetch method. Works portably across Windows, Linux, and Docker.
   * Requests raw text first, validates, and parses.
   */
  static fetchWithCurl(url, headers, timeout) {
    return new Promise((resolve, reject) => {
      let headerFlags = '';
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          if (key.toLowerCase() === 'accept-encoding') {
            continue;
          }
          const escapedValue = String(value).replace(/"/g, '\\"');
          headerFlags += ` -H "${key}: ${escapedValue}"`;
        }
      }
      
      const maxTimeSec = Math.ceil(timeout / 1000);
      const cmd = `curl -i -L -s --compressed --max-time ${maxTimeSec}${headerFlags} "${url}"`;

      exec(cmd, { maxBuffer: 30 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
        if (err) {
          const classification = classifyCurlError(err, stdout, stderr);
          const errorObj = new Error(classification.message);
          errorObj.code = classification.code;
          errorObj.cmd = cmd;
          errorObj.exitCode = err.code;
          errorObj.stdout = stdout;
          errorObj.stderr = stderr;
          errorObj.killed = err.killed;
          errorObj.signal = err.signal;
          errorObj.status = null;
          return reject(errorObj);
        }
        
        // Parse curl -i output
        const httpHeaderRegex = /^HTTP\/\d+\.\d+\s+\d+/gmi;
        let matches;
        try {
          matches = [...stdout.matchAll(httpHeaderRegex)];
        } catch (matchErr) {
          return reject(matchErr); // Preserve original stack trace for matchAll TypeError
        }
        
        let body = stdout;
        let headersStr = '';
        
        if (matches.length > 0) {
          const lastMatch = matches[matches.length - 1];
          const lastHeaderIndex = lastMatch.index;
          const headerAndBody = stdout.substring(lastHeaderIndex);
          const doubleNewlineIndex = headerAndBody.search(/\r?\n\r?\n/);
          
          if (doubleNewlineIndex !== -1) {
            headersStr = headerAndBody.substring(0, doubleNewlineIndex);
            body = headerAndBody.substring(doubleNewlineIndex).trimStart();
          }
        }

        const parsedHeaders = {};
        let statusCode = 200;
        let contentType = '';

        if (headersStr) {
          const lines = headersStr.split(/\r?\n/);
          const firstLine = lines[0];
          const httpMatch = firstLine.match(/^HTTP\/(\d+\.\d+)\s+(\d+)/i);
          if (httpMatch) {
            parsedHeaders.httpVersion = httpMatch[1];
            parsedHeaders.statusCode = parseInt(httpMatch[2], 10);
            statusCode = parsedHeaders.statusCode;
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
          if (parsedHeaders['content-type']) {
            contentType = parsedHeaders['content-type'].toLowerCase();
          }
        }

        if (statusCode === 403 || isHtmlOrCloudflare(body) || contentType.includes('text/html')) {
          let reason = 'Cloudflare block detected';
          let errCode = 'CLOUDFLARE_BLOCK';
          const lowerBody = body.toLowerCase();
          
          if (lowerBody.includes('access denied')) {
            reason = 'Access Denied';
            errCode = 'HTTP_403';
          } else if (lowerBody.includes('captcha')) {
            reason = 'Captcha verification required';
          } else if (lowerBody.includes('maintenance')) {
            reason = 'Maintenance page';
          } else if (lowerBody.includes('login') || lowerBody.includes('signin')) {
            reason = 'Redirected to login page';
          } else if (lowerBody.includes('just a moment') || lowerBody.includes('cf-challenge')) {
            reason = 'Cloudflare challenge page';
          } else if (lowerBody.includes('redirect')) {
            reason = 'Redirect page';
          } else {
            reason = 'HTML response received';
          }
          
          const cfErr = new CloudflareBlockedError(`Cloudflare block detected (${reason}) for URL: ${url}`);
          cfErr.code = errCode;
          cfErr.status = statusCode;
          cfErr.cmd = cmd;
          cfErr.headers = parsedHeaders;
          cfErr.body = body;
          cfErr.stdout = stdout;
          cfErr.stderr = stderr;
          return reject(cfErr);
        }

        if (contentType && !contentType.includes('application/json')) {
          const cTypeErr = new Error(`Invalid content-type: "${contentType}". Expected "application/json".`);
          cTypeErr.code = 'INVALID_JSON';
          cTypeErr.status = statusCode;
          cTypeErr.cmd = cmd;
          cTypeErr.headers = parsedHeaders;
          cTypeErr.body = body;
          cTypeErr.stdout = stdout;
          cTypeErr.stderr = stderr;
          return reject(cTypeErr);
        }

        if (statusCode !== 200) {
          let errCode = `HTTP_${statusCode}`;
          if (statusCode === 404) {
            errCode = 'HTTP_404';
          } else if (statusCode === 429) {
            errCode = 'HTTP_429';
          }
          const httpErr = new Error(`Request failed with status code ${statusCode}`);
          httpErr.code = errCode;
          httpErr.status = statusCode;
          httpErr.cmd = cmd;
          httpErr.headers = parsedHeaders;
          httpErr.body = body;
          httpErr.stdout = stdout;
          httpErr.stderr = stderr;
          return reject(httpErr);
        }

        try {
          const data = JSON.parse(body);
          Object.defineProperty(data, 'cmd', { value: cmd, enumerable: false, writable: true });
          Object.defineProperty(data, 'headers', { value: parsedHeaders, enumerable: false, writable: true });
          resolve(data);
        } catch (parseErr) {
          const jsonErr = new Error(`Failed to parse response JSON: ${parseErr.message}`);
          jsonErr.code = 'INVALID_JSON';
          jsonErr.status = statusCode;
          jsonErr.cmd = cmd;
          jsonErr.headers = parsedHeaders;
          jsonErr.body = body;
          jsonErr.stdout = stdout;
          jsonErr.stderr = stderr;
          reject(jsonErr);
        }
      });
    });
  }

  /**
   * Normalizes errors into standard user-friendly formats.
   */
  static normalizeError(err, url) {
    if (err instanceof CloudflareBlockedError || err.name === 'CloudflareBlockedError' || err.isCloudflare) {
      const prefix = err.code ? `[${err.code}] ` : '[CLOUDFLARE_BLOCK] ';
      if (!err.message.startsWith('[')) {
        err.message = `${prefix}${err.message}`;
      }
      return err;
    }
    const errCode = err.code || 'REQUEST_FAILED';
    const prefix = `[${errCode}] `;
    let originalMessage = err.message || 'Request failed';
    if (!originalMessage.startsWith('[')) {
      originalMessage = `${prefix}${originalMessage}`;
    }
    const error = new Error(originalMessage);
    error.url = url;
    error.code = errCode;
    if (err.status) {
      error.status = err.status;
    }
    if (err.response) {
      error.status = err.response.status;
      error.data = err.response.data;
    }
    return error;
  }
}

NetworkService.CloudflareBlockedError = CloudflareBlockedError;
module.exports = NetworkService;
