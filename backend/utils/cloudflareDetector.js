/**
 * utils/cloudflareDetector.js
 * ===========================
 * Utility module to inspect HTTP response status, Content-Type, and body text
 * for HTML markup or Cloudflare security challenge markers BEFORE attempting JSON parsing.
 */

const CLOUDFLARE_MARKERS = [
  'just a moment',
  'cf-browser-verification',
  'cf-challenge',
  'cf-ray',
  'cloudflare',
  'challenge-platform',
  'window._cf_chl_opt',
  'attention required! | cloudflare',
  'enable javascript and cookies to continue',
  'please turn javascript on',
  'checking your browser',
  'ray id:'
];

const HTML_MARKERS = [
  '<!doctype html',
  '<html',
  '<head',
  '<body',
  '<title>',
  '<script',
  '<div class='
];

/**
 * Inspects content-type header, HTTP status, and response body to detect HTML or Cloudflare challenge pages.
 * 
 * @param {object} params
 * @param {number} [params.statusCode] - HTTP status code
 * @param {object|string} [params.headers] - Response headers
 * @param {string|*} [params.body] - Raw response body
 * @returns {{ isBlocked: boolean, isHtml: boolean, reason: string, matchedMarker: string|null }}
 */
function detectCloudflare({ statusCode, headers = {}, body = '' } = {}) {
  let isHtml = false;
  let isBlocked = false;
  let reason = 'Normal response';

  const bodyStr = typeof body === 'string' ? body : (body ? String(body) : '');
  const lowerBody = bodyStr.toLowerCase().trim();

  // Normalize headers
  const contentType = (
    headers['content-type'] ||
    headers['Content-Type'] ||
    ''
  ).toLowerCase();

  const serverHeader = (
    headers['server'] ||
    headers['Server'] ||
    ''
  ).toLowerCase();

  const cfRayHeader = headers['cf-ray'] || headers['Cf-Ray'];
  const cfMitigated = (headers['cf-mitigated'] || headers['Cf-Mitigated'] || '').toLowerCase();

  // Check Content-Type header
  if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
    isHtml = true;
  }

  // Check cf-mitigated header
  if (cfMitigated.includes('challenge') || cfMitigated.includes('jschallenge') || cfMitigated.includes('managed')) {
    isBlocked = true;
    reason = 'Cloudflare challenge header (cf-mitigated) detected';
  }

  // Check HTML tags in body
  if (!isHtml && HTML_MARKERS.some(marker => lowerBody.includes(marker))) {
    isHtml = true;
  }

  // Check Cloudflare markers in body
  const matchedMarker = CLOUDFLARE_MARKERS.find(marker => lowerBody.includes(marker));

  if (matchedMarker || (cfRayHeader && isHtml) || (serverHeader.includes('cloudflare') && isHtml)) {
    isBlocked = true;
    if (lowerBody.includes('access denied')) {
      reason = 'Access Denied page';
    } else if (lowerBody.includes('captcha')) {
      reason = 'Captcha verification required';
    } else if (lowerBody.includes('just a moment')) {
      reason = 'Cloudflare "Just a moment..." challenge page';
    } else if (matchedMarker) {
      reason = `Cloudflare marker detected: "${matchedMarker}"`;
    } else {
      reason = 'Cloudflare challenge page detected';
    }
  } else if (statusCode === 403) {
    isBlocked = true;
    reason = 'HTTP 403 Forbidden (Cloudflare block)';
  } else if (isHtml && !contentType.includes('application/json')) {
    isBlocked = true;
    reason = 'Received HTML response instead of JSON';
  }

  const effectiveMarker = matchedMarker || (serverHeader.includes('cloudflare') ? 'server: cloudflare' : (cfRayHeader ? `cf-ray: ${cfRayHeader}` : null));

  return {
    isBlocked,
    isHtml,
    reason,
    matchedMarker: effectiveMarker
  };
}

module.exports = {
  detectCloudflare,
  CLOUDFLARE_MARKERS,
  HTML_MARKERS
};
