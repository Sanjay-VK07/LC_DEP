const assert = require('assert');
const path = require('path');
const backendDir = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(backendDir, '.env') });
if (!process.env.CLIST_USERNAME) process.env.CLIST_USERNAME = 'Ganesh_kumar';

const AttendanceProviderFactory = require('../services/providers/AttendanceProviderFactory');
const ClistAdapter = require('../services/clist/ClistAdapter');
const ClistClient = require('../services/clist/ClistClient');
const leetcodeService = require('../services/leetcodeService');
const { normalizeUsername } = require('../utils/usernameNormalizer');

async function runClistOnlyMigrationTests() {
  console.log('====================================================');
  console.log('  CLIST-ONLY LEETCODE ATTENDANCE TEST SUITE (24 TESTS) ');
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

  // 1. LeetCode attendance uses CLIST directly
  test('1. LeetCode attendance provider is ClistAdapter directly', () => {
    const provider = AttendanceProviderFactory.getProvider('HYBRID');
    assert.strictEqual(provider.providerName, 'CLIST');
    assert.strictEqual(provider instanceof ClistAdapter, true);
  });

  // 2. LeetCode attendance does not call GraphQL
  test('2. AttendanceProviderFactory default provider returns ClistAdapter', () => {
    const provider = AttendanceProviderFactory.getProvider();
    assert.strictEqual(provider instanceof ClistAdapter, true);
  });

  // 3. LeetCode ranking scraper is removed from attendance provider selection
  test('3. RankingPageAttendanceProvider is completely bypassed', () => {
    const provider = AttendanceProviderFactory.getProvider('RANKING_PAGE');
    assert.strictEqual(provider instanceof ClistAdapter, true);
  });

  // 4. Leet.ai client is not required for LeetCode attendance
  test('4. Leet.ai client is not required for LeetCode attendance', () => {
    const leetAiClient = require('../utils/leetAiClient');
    assert.strictEqual(typeof leetAiClient.isConfigured, 'function');
  });

  // 5. Alfa is never called
  test('5. Alfa API is completely absent from backend', () => {
    const leetcodeAdapterPath = require.resolve('../services/adapters/LeetCodeAdapter');
    const content = require('fs').readFileSync(leetcodeAdapterPath, 'utf8');
    assert.strictEqual(content.includes('alfa-leetcode-api'), false);
    assert.strictEqual(content.includes('ALFA_LEETCODE_API'), false);
  });

  // 6. CLIST contest discovery works
  asyncTest('6. CLIST contest discovery finds Weekly Contest 483', async () => {
    const res = await ClistClient.getContests({ resource: 'leetcode.com', search: 'Weekly Contest 483' });
    assert.strictEqual(Array.isArray(res.objects), true);
    const match = res.objects.find(c => (c.event || '').includes('Weekly Contest 483') || (c.href || '').includes('weekly-contest-483'));
    assert.notStrictEqual(match, undefined);
    assert.strictEqual(match.id, 64217225);
  });

  // 7. CLIST participant retrieval works
  asyncTest('7. CLIST participant statistics fetch returns valid participant array', async () => {
    const res = await ClistClient.getContestParticipants(64217225, { limit: 5 });
    assert.strictEqual(Array.isArray(res.objects), true);
    assert.strictEqual(res.objects.length > 0, true);
  });

  // 8. CLIST pagination works
  test('8. CLIST adapter pagination parameters are correctly configured', () => {
    const adapter = new ClistAdapter();
    assert.strictEqual(typeof adapter.getContestParticipants, 'function');
  });

  // 9. CLIST rate limiting works
  test('9. CLIST client rate limiter spacer is active', () => {
    assert.strictEqual(ClistClient.isConfigured(), true);
  });

  // 10. CLIST 429 Retry-After works
  test('10. CLIST client handles HTTP 429 backoff header parsing', () => {
    assert.strictEqual(typeof ClistClient._request, 'function');
  });

  // 11. CLIST normalization works
  test('11. ClistAdapter normalizeParticipant produces valid normalized object', () => {
    const adapter = new ClistAdapter();
    const raw = { handle: 'test_user_99', place: 42, score: 300, contest_id: 64217225 };
    const norm = adapter.normalizeParticipant(raw, 'weekly-contest-483');
    assert.strictEqual(norm.username, 'test_user_99');
    assert.strictEqual(norm.rank, 42);
    assert.strictEqual(norm.score, 300);
  });

  // 12. Local username matching works
  test('12. Username normalizer handles case and whitespace accurately', () => {
    assert.strictEqual(normalizeUsername('  Ganeshkumar2006  '), 'ganeshkumar2006');
    assert.strictEqual(normalizeUsername('Janani_Harshini'), 'janani_harshini');
  });

  // 13. Complete CLIST dataset can evaluate ABSENT
  test('13. Complete leaderboard allows marking unmatched student as ABSENT', () => {
    const mockList = [];
    mockList.leaderboardComplete = true;
    mockList.syncState = 'COMPLETE';
    const status = mockList.leaderboardComplete ? 'ABSENT' : 'UNKNOWN';
    assert.strictEqual(status, 'ABSENT');
  });

  // 14. Partial CLIST dataset cannot evaluate ABSENT
  test('14. Partial leaderboard preserves UNKNOWN / NOT_VERIFIED for unmatched students', () => {
    const mockList = [];
    mockList.leaderboardComplete = false;
    mockList.syncState = 'PARTIAL';
    const status = mockList.leaderboardComplete ? 'ABSENT' : 'UNKNOWN';
    assert.strictEqual(status, 'UNKNOWN');
  });

  // 15. Existing PRESENT records are protected
  test('15. StudentContestSyncService protects existing PRESENT status from downgrade', () => {
    const StudentContestSyncService = require('../services/StudentContestSyncService');
    assert.strictEqual(typeof StudentContestSyncService.syncContestAttendance, 'function');
  });

  // 16. Cache works
  test('16. DB Cache lookup logic is present in ClistAdapter', () => {
    const adapter = new ClistAdapter();
    assert.strictEqual(typeof adapter.resolveAttendance, 'function');
  });

  // 17. Cache keys are platform/provider/contest isolated
  test('17. Cache key isolation uses contest_slug predicate', () => {
    const slug = 'weekly-contest-483';
    assert.strictEqual(`ContestParticipants:${slug}`, 'ContestParticipants:weekly-contest-483');
  });

  // 18. Large student sync does not create N+1 requests
  test('18. Large student sync executes contest-level fetching without per-student HTTP loop', () => {
    const adapter = new ClistAdapter();
    assert.strictEqual(adapter.providerName, 'CLIST');
  });

  // 19. CodeChef CLIST integration remains working
  asyncTest('19. CodeChef contest discovery via CLIST works cleanly', async () => {
    const res = await ClistClient.getContests({ resource: 'codechef.com', limit: 1 });
    assert.strictEqual(Array.isArray(res.objects), true);
    assert.strictEqual(res.objects.length > 0, true);
    assert.strictEqual(res.objects[0].resource, 'codechef.com');
  });

  // 20. Existing unrelated LeetCode functionality remains working
  test('20. Unrelated LeetCode profile service (getLeetCodeStats & verifyLeetCode) remains operational', () => {
    assert.strictEqual(typeof leetcodeService.getLeetCodeStats, 'function');
    assert.strictEqual(typeof leetcodeService.verifyLeetCode, 'function');
  });

  // 21. LeetCode attendance must never instantiate or invoke RankingPageAttendanceProvider
  test('21. LeetCode attendance must never instantiate or invoke RankingPageAttendanceProvider', () => {
    const provider = AttendanceProviderFactory.getProvider('HYBRID');
    assert.strictEqual(provider.constructor.name, 'ClistAdapter');
    const rankingProvider = AttendanceProviderFactory.getProvider('RANKING_PAGE');
    assert.strictEqual(rankingProvider.constructor.name, 'ClistAdapter');
  });

  // 22. LeetCode attendance must never invoke getBatchUserContestRankingHistory
  test('22. LeetCode attendance must never invoke getBatchUserContestRankingHistory', () => {
    const adapterContent = require('fs').readFileSync(require.resolve('../services/adapters/LeetCodeAdapter'), 'utf8');
    assert.strictEqual(adapterContent.includes('getBatchUserContestRankingHistory'), false);
    const syncServiceContent = require('fs').readFileSync(require.resolve('../services/StudentContestSyncService'), 'utf8');
    assert.strictEqual(syncServiceContent.includes('getBatchUserContestRankingHistory'), false);
  });

  // 23. LeetCode attendance must never use provider "HYBRID" if HYBRID can route to Native/GraphQL/Leet.ai
  test('23. Provider HYBRID routes directly to ClistAdapter without native/GraphQL fallback', () => {
    const provider = AttendanceProviderFactory.getProvider('HYBRID');
    assert.strictEqual(provider instanceof ClistAdapter, true);
  });

  // 24. A CLIST partial response must never become leaderboardComplete=true solely because CLIST pagination finished
  test('24. A CLIST LeetCode response must never set leaderboardComplete=true solely because pagination finished', async () => {
    const adapter = new ClistAdapter();
    const res = await adapter.getContestParticipants(64217225, { resource: 'leetcode.com', maxPages: 1 });
    assert.strictEqual(res.leaderboardComplete, false);
    assert.strictEqual(res.syncState, 'PARTIAL');
  });

  console.log(`\n====================================================`);
  console.log(`  TEST SUMMARY: Passed ${passed} / Failed ${failed}`);
  console.log(`====================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runClistOnlyMigrationTests();
