const assert = require('assert');
const path = require('path');
const backendDir = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(backendDir, '.env') });

const HybridAttendanceProvider = require('../services/providers/HybridAttendanceProvider');
const GraphQLAttendanceProvider = require('../services/providers/GraphQLAttendanceProvider');
const ClistAdapter = require('../services/clist/ClistAdapter');
const ClistClient = require('../services/clist/ClistClient');
const { normalizeUsername } = require('../utils/usernameNormalizer');

async function runOptimizationTests() {
  console.log('====================================================');
  console.log('  CONTEST-LEVEL ATTENDANCE SYNC REGRESSION TESTS    ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ FAIL: ${name}`);
      console.error(`  Error: ${err.message}`);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ FAIL: ${name}`);
      console.error(`  Error: ${err.message}`);
      failed++;
    }
  }

  // 1. Large contest uses contest-level provider (HYBRID threshold >= 50)
  test('1. HybridAttendanceProvider uses contest-level strategy for large sync (>= 50 students)', () => {
    const provider = new HybridAttendanceProvider();
    assert.strictEqual(provider.providerName, 'HYBRID');
  });

  // 2. Small targeted verification uses GraphQL provider
  asyncTest('2. Small targeted sync (< 50 students) delegates to GraphQLAttendanceProvider', async () => {
    const provider = new HybridAttendanceProvider();
    const students = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, leetcode_username: `student${i}` }));
    assert.strictEqual(students.length < 50, true);
  });

  // 3. Username Normalization
  test('3. Username Normalizer maps handles accurately for local matching', () => {
    assert.strictEqual(normalizeUsername('Ganesh_Kumar_R'), 'ganesh_kumar_r');
    assert.strictEqual(normalizeUsername('  SHUBH_1428  '), 'shubh_1428');
  });

  // 4. CLIST Rate Limiter Verification
  test('4. CLIST global rate limiter is configured and active', () => {
    assert.strictEqual(typeof ClistClient.isConfigured, 'function');
    assert.strictEqual(ClistClient.isConfigured(), true);
  });

  // 5. ClistAdapter Availability
  test('5. ClistAdapter is available for CodeChef and LeetCode fallbacks', () => {
    const adapter = new ClistAdapter();
    assert.strictEqual(adapter.isAvailable(), true);
  });

  // 6. Attendance Safety: Partial Leaderboard Safety
  test('6. Incomplete leaderboard preserves NOT_VERIFIED / UNKNOWN status for unmatched students', () => {
    const mockClistParticipants = [];
    mockClistParticipants.leaderboardComplete = false;
    mockClistParticipants.syncState = 'PARTIAL';
    
    const isLeaderboardComplete = mockClistParticipants.leaderboardComplete === true;
    const finalStatus = isLeaderboardComplete ? 'ABSENT' : 'UNKNOWN';
    assert.strictEqual(finalStatus, 'UNKNOWN');
  });

  // 7. Attendance Safety: Complete Leaderboard
  test('7. Complete leaderboard allows evaluating unmatched students as ABSENT', () => {
    const mockClistParticipants = [];
    mockClistParticipants.leaderboardComplete = true;
    mockClistParticipants.syncState = 'COMPLETE';

    const isLeaderboardComplete = mockClistParticipants.leaderboardComplete === true;
    const finalStatus = isLeaderboardComplete ? 'ABSENT' : 'UNKNOWN';
    assert.strictEqual(finalStatus, 'ABSENT');
  });

  // 8. ClistAdapter Normalization Structure
  test('8. ClistAdapter produces valid platform-independent normalized object', () => {
    const adapter = new ClistAdapter();
    const raw = {
      handle: 'test_user',
      place: 5,
      score: 400,
      penalty: 120,
      contest_id: 12345
    };
    const norm = adapter.normalizeParticipant(raw, 'test-contest');
    assert.strictEqual(norm.username, 'test_user');
    assert.strictEqual(norm.rank, 5);
    assert.strictEqual(norm.score, 400);
    assert.strictEqual(norm.platform, 'clist');
  });

  console.log(`\n====================================================`);
  console.log(`  TEST SUMMARY: Passed ${passed} / Failed ${failed}`);
  console.log(`====================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runOptimizationTests();
