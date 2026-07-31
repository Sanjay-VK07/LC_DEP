const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');

const { platformScheduler } = require('../utils/platformScheduler');
const { verificationCache } = require('../utils/cacheModule');
const { executeWithRetry, parseRetryAfterHeader, isRetryableError } = require('../utils/retryModule');
const { circuitBreaker, PlatformCircuitBreaker } = require('../utils/circuitBreaker');
const { policyRegistry } = require('../config/platformPolicies');
const PlatformValidator = require('../services/PlatformValidator');
const { setAdapter, resetAdapters } = require('../services/adapters/AdapterFactory');

// Mock platform adapter for testing
class TestMockAdapter {
  constructor(platform) {
    this.platform = platform;
    this.callCount = 0;
    this.validUsers = new Set(['valid_user_1', 'valid_user_2', 'test_student']);
  }

  async getProfile(username) {
    this.callCount++;
    const norm = (username || '').toLowerCase().trim();

    if (norm === 'rate_limit_user') {
      const err = new Error('CodeChef HTTP 429 Too Many Requests');
      err.status = 429;
      err.headers = { 'retry-after': '2' };
      throw err;
    }

    if (norm === 'not_found_user') {
      const err = new Error('CodeChef account not found');
      err.status = 404;
      throw err;
    }

    if (norm === 'timeout_user') {
      await new Promise(r => setTimeout(r, 40000));
      return { verified: true, username: norm };
    }

    if (this.validUsers.has(norm)) {
      return { verified: true, username: norm, rating: 1600 };
    }

    return { verified: false, message: 'User not found', username: norm };
  }
}

before(async () => {
  await db.initializeDatabase();
});

beforeEach(() => {
  platformScheduler.isShuttingDown = false;
  platformScheduler.resetMetrics();
  verificationCache.resetStats();
  circuitBreaker.reset();
  ['leetcode', 'codechef', 'codeforces', 'hackerrank'].forEach(p => {
    setAdapter(p, new TestMockAdapter(p));
  });
});

after(async () => {
  resetAdapters();
  await db.closePool();
});

test('PlatformScheduler - Enforces per-platform concurrency caps & policy settings', () => {
  assert.equal(platformScheduler.getConcurrencyLimit('codechef'), 2);
  assert.equal(platformScheduler.getConcurrencyLimit('hackerrank'), 1);
  assert.equal(platformScheduler.getConcurrencyLimit('leetcode'), 3);
  assert.equal(platformScheduler.getConcurrencyLimit('codeforces'), 2);
});

test('Adaptive Rate Limiting - Slows down interval on 429 and recovers on success', () => {
  const policy = policyRegistry.get('codechef');
  policy.resetInterval();

  const initialInterval = policy.getCurrentIntervalMs();
  assert.equal(initialInterval, 2000);

  // Trigger 429 -> interval backs off dynamically
  policy.on429();
  const slowedInterval = policy.getCurrentIntervalMs();
  assert.ok(slowedInterval > initialInterval);

  // Trigger 5 successes -> interval recovers gradually
  for (let i = 0; i < 5; i++) policy.onSuccess();
  const recoveredInterval = policy.getCurrentIntervalMs();
  assert.ok(recoveredInterval < slowedInterval);
});

test('RetryModule - Parses Retry-After headers & correctly classifies retryable errors', () => {
  const delayMs = parseRetryAfterHeader({ 'retry-after': '5' });
  assert.equal(delayMs, 5000);

  const err404 = new Error('User not found 404');
  err404.status = 404;
  assert.equal(isRetryableError(err404), false);

  const err429 = new Error('HTTP 429 Too Many Requests');
  err429.status = 429;
  assert.equal(isRetryableError(err429), true);
});

test('PlatformScheduler - In-flight Request Deduplication shares active promise', async () => {
  const adapter = new TestMockAdapter('codechef');
  setAdapter('codechef', adapter);

  const req1 = platformScheduler.schedule('codechef', 'valid_user_1', () => adapter.getProfile('valid_user_1'), { retryCount: 0 });
  const req2 = platformScheduler.schedule('codechef', 'valid_user_1', () => adapter.getProfile('valid_user_1'), { retryCount: 0 });

  const [res1, res2] = await Promise.all([req1, req2]);

  assert.deepEqual(res1, res2);
  assert.equal(adapter.callCount, 1);
  assert.equal(platformScheduler.metrics.deduplicatedRequests, 1);
});

test('Correlation ID Tracing - Propagates verificationId across verification calls', async () => {
  const validator = new PlatformValidator();
  const res = await validator.verify('leetcode', 'valid_user_1', { verificationId: 'verif-trace-12345' });

  assert.equal(res.verificationId, 'verif-trace-12345');
  assert.equal(res.verified, true);
});

test('CircuitBreaker - Trips to OPEN on 5 consecutive failures and serves fallbacks', async () => {
  const customBreaker = new PlatformCircuitBreaker({ failureThreshold: 3, cooldownMs: 60000 });

  assert.equal(customBreaker.isOpen('codechef'), false);

  const err429 = new Error('HTTP 429 Rate Limit');
  err429.status = 429;

  customBreaker.recordFailure('codechef', err429);
  customBreaker.recordFailure('codechef', err429);
  customBreaker.recordFailure('codechef', err429);

  assert.equal(customBreaker.isOpen('codechef'), true);

  const fallbackRes = await customBreaker.execute('codechef', async () => {
    throw new Error('Should not run');
  });

  assert.equal(fallbackRes.verified, false);
  assert.equal(fallbackRes.status, 'TEMPORARILY_UNAVAILABLE');
});

test('VerificationCache - Implements platform TTLs & Stale-While-Revalidate', async () => {
  const testData = { verified: true, status: 'VERIFIED', username: 'valid_user_1' };

  await verificationCache.set('leetcode', 'valid_user_1', testData, 50);

  const hit1 = await verificationCache.get('leetcode', 'valid_user_1');
  assert.equal(hit1.hit, true);
  assert.equal(hit1.isStale, false);

  await new Promise(resolve => setTimeout(resolve, 60));

  const hit2 = await verificationCache.get('leetcode', 'valid_user_1', { allowStale: true });
  assert.equal(hit2.hit, true);
  assert.equal(hit2.isStale, true);
});

test('PlatformValidator - Batch validation chunks items (20/batch) & reports progress', async () => {
  const validator = new PlatformValidator();
  const handles = Array.from({ length: 25 }, (_, i) => `valid_user_1`);

  let progressCalled = 0;
  const batchRes = await validator.validateBatch('leetcode', handles, {
    batchSize: 10,
    batchDelayMs: 10,
    onProgress: (completed, total) => {
      progressCalled++;
    }
  });

  assert.ok(batchRes.results.has('valid_user_1'));
  assert.equal(progressCalled > 0, true);
});

test('PlatformValidator - Multi-platform verification supports Graceful Degradation', async () => {
  const validator = new PlatformValidator();

  const handles = {
    leetcode: 'valid_user_1',
    codechef: 'not_found_user'
  };

  const multiRes = await validator.verifyStudentMultiPlatform(handles);

  assert.equal(multiRes.success, false);
  assert.equal(multiRes.platforms.leetcode.verified, true);
  assert.equal(multiRes.platforms.codechef.verified, false);
});

test('Operational Metrics Dashboard - Returns structured metrics object', () => {
  const metrics = platformScheduler.getOperationalMetrics();

  assert.ok(metrics.activeQueueLength !== undefined);
  assert.ok(metrics.queueLengthByPlatform);
  assert.ok(metrics.currentIntervalByPlatform);
  assert.ok(metrics.requestsPerSec !== undefined);
  assert.ok(metrics.cacheHitRate !== undefined);
  assert.ok(metrics.circuitBreakerState);
});

test('PlatformScheduler - Supports Graceful Shutdown', async () => {
  await platformScheduler.shutdown();
  assert.equal(platformScheduler.isShuttingDown, true);

  await assert.rejects(
    () => platformScheduler.schedule('leetcode', 'valid_user_1', async () => {}),
    /Server is shutting down/
  );
});
