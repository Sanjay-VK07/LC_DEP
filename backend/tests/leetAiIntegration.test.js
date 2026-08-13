const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const leetAiClient = require('../utils/leetAiClient');
const LeetCodeAdapter = require('../services/adapters/LeetCodeAdapter');

async function runTests() {
  console.log('====================================================');
  console.log('  Leet.ai & Fallback Integration Test Suite  ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.stack || err.message}\n`);
      failed++;
    }
  }

  // Test 1: Configuration Detection
  await test('Test 1 — Configuration Detection', async () => {
    const isConfigured = leetAiClient.isConfigured();
    assert.strictEqual(typeof isConfigured, 'boolean');
  });

  // Test 2: Endpoint Support Verification
  await test('Test 2 — Endpoint Support Verification', async () => {
    const hasEndpoint = leetAiClient.hasContestParticipantEndpoint('weekly-contest-400');
    assert.strictEqual(typeof hasEndpoint, 'boolean');
  });

  // Test 3: Deduplication in LeetCodeAdapter
  await test('Test 3 — Request Deduplication in LeetCodeAdapter', async () => {
    const adapter = new LeetCodeAdapter();
    const origPipeline = adapter._executeContestSyncPipeline;

    adapter._executeContestSyncPipeline = async (slug) => {
      await new Promise(r => setTimeout(r, 50));
      return [{ username: 'dedup_user', rank: 10, score: 20 }];
    };

    try {
      const p1 = adapter.getContestParticipants('weekly-contest-400');
      const p2 = adapter.getContestParticipants('weekly-contest-400');

      const [res1, res2] = await Promise.all([p1, p2]);
      assert.strictEqual(res1[0].username, 'dedup_user');
      assert.strictEqual(res2[0].username, 'dedup_user');
    } finally {
      adapter._executeContestSyncPipeline = origPipeline;
    }
  });

  // Test 4: Rate-Limit Delay & Concurrency Settings
  await test('Test 4 — Rate-Limit Delay & Concurrency Settings', async () => {
    const delay = parseInt(process.env.LEETCODE_PAGE_DELAY_MS, 10) || 50;
    const concurrency = parseInt(process.env.LEETCODE_PAGE_CONCURRENCY, 10) || 10;
    assert(delay >= 0, 'Page delay must be non-negative');
    assert(concurrency > 0, 'Concurrency must be positive');
  });

  // Test 5: Cache Reuse
  await test('Test 5 — Cache Reuse in LeetCodeAdapter', async () => {
    const adapter = new LeetCodeAdapter();
    const mockCache = {
      usable: true,
      count: 25,
      participants: [{ username: 'cached_user', rank: 1, score: 20 }],
      reason: 'fresh'
    };

    const origCheck = adapter._checkCache;
    adapter._checkCache = async () => mockCache;

    try {
      const result = await adapter.getContestParticipants('weekly-contest-400');
      assert.strictEqual(result.fromCache, true, 'Result must be flagged fromCache: true');
      assert.strictEqual(result.source, 'CACHE', 'Source must be CACHE');
      assert.strictEqual(result[0].username, 'cached_user');
    } finally {
      adapter._checkCache = origCheck;
    }
  });

  // Test 6: CLIST Provider Fallback Architecture
  await test('Test 6 — CLIST Provider Integration', async () => {
    const ClistAdapterClass = require('../services/clist/ClistAdapter');
    const clistAdapter = new ClistAdapterClass();
    assert.strictEqual(clistAdapter.providerName, 'CLIST');
    assert.strictEqual(typeof clistAdapter.getContestParticipants, 'function');
  });

  console.log('\n====================================================');
  console.log(`  Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error during integration tests:', err);
  process.exit(1);
});
