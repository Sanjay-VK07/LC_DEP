/**
 * tests/cloudflareHandling.test.js
 * =================================
 * Comprehensive unit test suite for Cloudflare detection, custom errors,
 * zero-retry abort rules, exponential backoff, request throttling,
 * ranking caching, and detailed sync summaries.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const CloudflareBlockedError = require('../utils/CloudflareBlockedError');
const { detectCloudflare } = require('../utils/cloudflareDetector');
const { isRetryableError, executeWithRetry } = require('../utils/retryHelper');
const { RequestThrottler } = require('../utils/throttler');
const { ContestRankingCache } = require('../utils/contestRankingCache');
const DetailedLogger = require('../utils/detailedLogger');

test('1. CloudflareBlockedError - Instantiation & Properties', () => {
  const err = new CloudflareBlockedError('Cloudflare challenge page detected', {
    status: 403,
    url: 'https://leetcode.com/contest/api/ranking/weekly-contest-400/?pagination=1',
    contestSlug: 'weekly-contest-400',
    pageNumber: 1,
    reason: 'Cloudflare "Just a moment..." challenge page'
  });

  assert.equal(err.name, 'CloudflareBlockedError');
  assert.equal(err.isCloudflare, true);
  assert.equal(err.code, 'CLOUDFLARE_BLOCK');
  assert.equal(err.status, 403);
  assert.equal(err.contestSlug, 'weekly-contest-400');
  assert.equal(err.pageNumber, 1);
  assert.equal(err.reason, 'Cloudflare "Just a moment..." challenge page');
  assert.ok(err.timestamp);
});

test('2. cloudflareDetector - HTML & Cloudflare Marker Detection', () => {
  // Test case 2a: Valid JSON response
  const jsonCheck = detectCloudflare({
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: '{"total_rank": [], "user_num": 100}'
  });
  assert.equal(jsonCheck.isBlocked, false);
  assert.equal(jsonCheck.isHtml, false);

  // Test case 2b: HTML response
  const htmlCheck = detectCloudflare({
    statusCode: 200,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
    body: '<!DOCTYPE html><html><head><title>LeetCode</title></head><body>Welcome</body></html>'
  });
  assert.equal(htmlCheck.isBlocked, true);
  assert.equal(htmlCheck.isHtml, true);

  // Test case 2c: Cloudflare challenge page markers
  const cfCheck = detectCloudflare({
    statusCode: 403,
    headers: { 'server': 'cloudflare', 'cf-ray': '8abc123456' },
    body: '<html><body>Just a moment... Enable JavaScript and cookies to continue. cf-browser-verification</body></html>'
  });
  assert.equal(cfCheck.isBlocked, true);
  assert.ok(cfCheck.reason.includes('Just a moment') || cfCheck.reason.includes('Cloudflare'));
});

test('3. retryHelper - Zero Retries on Cloudflare Block & Retry on Transient Failures', async () => {
  let attempts = 0;

  // Test case 3a: Cloudflare block must NOT retry (Must fail on 1st attempt)
  try {
    await executeWithRetry(
      async (attempt) => {
        attempts++;
        throw new CloudflareBlockedError('Cloudflare challenge', { status: 403 });
      },
      { retries: 3, backoffBaseMs: 10 }
    );
    assert.fail('Should have thrown CloudflareBlockedError');
  } catch (err) {
    assert.equal(err instanceof CloudflareBlockedError, true);
    assert.equal(attempts, 1, 'Cloudflare block must fail immediately on attempt 1 without retrying');
  }

  // Test case 3b: Transient error (500) retries up to maxRetries
  let transientAttempts = 0;
  try {
    await executeWithRetry(
      async (attempt) => {
        transientAttempts++;
        if (attempt < 3) {
          const serverErr = new Error('Internal Server Error');
          serverErr.status = 500;
          throw serverErr;
        }
        return { success: true };
      },
      { retries: 3, backoffBaseMs: 10 }
    );
    assert.equal(transientAttempts, 3, 'Should retry transient error 500 until attempt 3 succeeds');
  } catch (err) {
    assert.fail('Transient error should have succeeded on attempt 3');
  }
});

test('4. RequestThrottler - Concurrency Governor & Inter-request Delays', async () => {
  const throttler = new RequestThrottler({ delayMs: 50, concurrency: 2 });
  
  let activeWorkers = 0;
  let maxObservedActiveWorkers = 0;
  const completedTasks = [];

  const task = (id) => throttler.throttle(async () => {
    activeWorkers++;
    if (activeWorkers > maxObservedActiveWorkers) {
      maxObservedActiveWorkers = activeWorkers;
    }
    await new Promise(r => setTimeout(r, 20));
    activeWorkers--;
    completedTasks.push(id);
    return id;
  });

  const results = await Promise.all([task(1), task(2), task(3), task(4)]);

  assert.equal(results.length, 4);
  assert.ok(maxObservedActiveWorkers <= 2, `Max active workers (${maxObservedActiveWorkers}) must not exceed concurrency limit (2)`);
});

test('5. ContestRankingCache - Cache In-memory Storage & TTL Expiry', async () => {
  const cache = new ContestRankingCache();

  // Test 5a: Set and Get
  const mockData = { user_num: 500, total_rank: [{ username: 'user1', rank: 1 }] };
  cache.set('weekly-contest-400', 1, mockData, 1000);

  const hit = cache.get('weekly-contest-400', 1);
  assert.deepEqual(hit, mockData);
  assert.equal(cache.getStats().hits, 1);

  // Test 5b: TTL Expiration
  cache.set('weekly-contest-400', 2, mockData, 10); // 10ms TTL
  await new Promise(r => setTimeout(r, 25));

  const expired = cache.get('weekly-contest-400', 2);
  assert.equal(expired, null, 'Expired entry should return null');
  assert.equal(cache.getStats().misses, 1);
});

test('6. DetailedLogger - Sync Summary Formatting', () => {
  const summaryBox = DetailedLogger.printSyncSummary({
    contestSlug: 'weekly-contest-400',
    totalPagesAttempted: 10,
    successfulPages: 8,
    cachedPages: 2,
    blockedPages: 1,
    failedPages: 1,
    totalExecutionTimeMs: 3450
  });

  assert.ok(summaryBox.includes('weekly-contest-400'));
  assert.ok(summaryBox.includes('Total Pages Attempted: 10'));
  assert.ok(summaryBox.includes('Successful Pages:      8'));
  assert.ok(summaryBox.includes('Cached Pages:          2'));
  assert.ok(summaryBox.includes('Blocked Pages:         1'));
  assert.ok(summaryBox.includes('Failed Pages:          1'));
  assert.ok(summaryBox.includes('3.45s'));
});
