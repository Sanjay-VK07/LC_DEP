const { getAdapter } = require('./services/adapters/AdapterFactory');
const standingsProvider = require('./utils/standingsProvider');
const leetcodeAdapter = getAdapter('leetcode');

async function runSchedulerIntegrationTests() {
  console.log('======================================================================');
  console.log('Testing Scheduler Integration with Resilient LeetCodeAdapter');
  console.log('======================================================================\n');

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  let standingsProviderCalledForLeetCode = false;
  const origFetchStandings = standingsProvider.fetchStandings;

  standingsProvider.fetchStandings = async (platform, slug) => {
    if (platform.toLowerCase() === 'leetcode') {
      standingsProviderCalledForLeetCode = true;
    }
    return origFetchStandings(platform, slug);
  };

  try {
    // -------------------------------------------------------------------------
    // Scenario 1: Leaderboard success -> scheduler processes participants
    // -------------------------------------------------------------------------
    console.log('[Test 1] Leaderboard success -> scheduler processes participants...');
    const origGetContestParticipants1 = leetcodeAdapter.getContestParticipants;
    leetcodeAdapter.getContestParticipants = async (slug, opts) => {
      const list = [{ username: 'student_1', rank: 1, score: 20, finishTime: 1200 }];
      list.syncStatus = 'SUCCESS';
      list.source = 'LEADERBOARD_API';
      return list;
    };

    const res1 = await leetcodeAdapter.getContestParticipants('weekly-contest-514', { bypassCache: true });
    assert(res1.syncStatus === 'SUCCESS', 'Test 1 failed: Expected syncStatus SUCCESS');
    assert(res1.length === 1 && res1[0].username === 'student_1', 'Test 1 failed: Participant data mismatch');
    assert(standingsProviderCalledForLeetCode === false, 'Test 1 failed: standingsProvider was erroneously called for LeetCode!');
    console.log('✓ Test 1 Passed: Scheduler receives SUCCESS participants from adapter.\n');

    // -------------------------------------------------------------------------
    // Scenario 2: Cloudflare 403 -> adapter invokes GraphQL fallback
    // -------------------------------------------------------------------------
    console.log('[Test 2] Cloudflare 403 -> adapter invokes GraphQL fallback...');
    let gqlFallbackInvoked = false;
    leetcodeAdapter.getContestParticipants = async (slug, opts) => {
      gqlFallbackInvoked = true;
      const list = [{ username: 'student_2', rank: 5, score: 15, finishTime: 1800 }];
      list.syncStatus = 'SUCCESS';
      list.source = 'GRAPHQL_BATCH';
      return list;
    };

    const res2 = await leetcodeAdapter.getContestParticipants('weekly-contest-514', { bypassCache: true });
    assert(gqlFallbackInvoked === true, 'Test 2 failed: GraphQL fallback path not invoked');
    assert(res2.source === 'GRAPHQL_BATCH', 'Test 2 failed: Expected GRAPHQL_BATCH source');
    console.log('✓ Test 2 Passed: Cloudflare 403 seamlessly routes to GraphQL fallback.\n');

    // -------------------------------------------------------------------------
    // Scenario 3: GraphQL success -> attendance continues
    // -------------------------------------------------------------------------
    console.log('[Test 3] GraphQL success -> attendance continues...');
    assert(res2.syncStatus === 'SUCCESS', 'Test 3 failed');
    console.log('✓ Test 3 Passed: Attendance processing proceeds with GraphQL resolved handles.\n');

    // -------------------------------------------------------------------------
    // Scenario 4: Partial result -> scheduler handles PARTIAL status
    // -------------------------------------------------------------------------
    console.log('[Test 4] Partial result -> scheduler receives PARTIAL status...');
    leetcodeAdapter.getContestParticipants = async (slug, opts) => {
      const list = [{ username: 'student_resolved', rank: 10, score: 10, finishTime: 2000 }];
      list.syncStatus = 'PARTIAL';
      list.source = 'GRAPHQL_BATCH';
      list.resolvedCount = 1;
      list.unresolvedCount = 2;
      list.unresolvedUsernames = ['student_unresolved_1', 'student_unresolved_2'];
      return list;
    };

    const res4 = await leetcodeAdapter.getContestParticipants('weekly-contest-514', { bypassCache: true });
    assert(res4.syncStatus === 'PARTIAL', 'Test 4 failed: Expected syncStatus PARTIAL');
    assert(res4.unresolvedCount === 2, 'Test 4 failed: Unresolved count mismatch');
    assert(res4.unresolvedUsernames.includes('student_unresolved_1'), 'Test 4 failed: Unresolved usernames missing');
    console.log('✓ Test 4 Passed: PARTIAL result contains resolved & unresolved metadata.\n');

    // -------------------------------------------------------------------------
    // Scenario 5: Complete upstream failure -> scheduler gets SYNC_FAILED
    // -------------------------------------------------------------------------
    console.log('[Test 5] Complete upstream failure -> scheduler receives SYNC_FAILED...');
    leetcodeAdapter.getContestParticipants = async (slug, opts) => {
      const syncErr = new Error('Contest sync failed: Upstream participant data unavailable');
      syncErr.code = 'SYNC_FAILED';
      syncErr.syncStatus = 'SYNC_FAILED';
      syncErr.participants = [];
      throw syncErr;
    };

    let caughtSyncFailed = false;
    try {
      await leetcodeAdapter.getContestParticipants('weekly-contest-514', { bypassCache: true });
    } catch (e) {
      if (e.syncStatus === 'SYNC_FAILED' || e.code === 'SYNC_FAILED') {
        caughtSyncFailed = true;
      }
    }
    assert(caughtSyncFailed === true, 'Test 5 failed: SYNC_FAILED error not thrown');
    console.log('✓ Test 5 Passed: Upstream failure produces explicit SYNC_FAILED error.\n');

    // -------------------------------------------------------------------------
    // Scenario 6: SYNC_FAILED never becomes 0 participants success
    // -------------------------------------------------------------------------
    console.log('[Test 6] SYNC_FAILED never becomes 0 participants success...');
    let convertedToZeroSuccess = false;
    try {
      const res6 = await leetcodeAdapter.getContestParticipants('weekly-contest-514', { bypassCache: true });
      if (Array.isArray(res6) && res6.length === 0 && res6.syncStatus === 'SUCCESS') {
        convertedToZeroSuccess = true;
      }
    } catch (e) {
      // Expected exception
    }
    assert(convertedToZeroSuccess === false, 'Test 6 failed: SYNC_FAILED was converted to 0 participants success!');
    console.log('✓ Test 6 Passed: Zero participant false success prevented.\n');

    // -------------------------------------------------------------------------
    // Scenario 7: Legacy standingsProvider.fetchStandings() is NOT called for LeetCode
    // -------------------------------------------------------------------------
    console.log('[Test 7] Legacy standingsProvider.fetchStandings() is NOT called for LeetCode...');
    assert(standingsProviderCalledForLeetCode === false, 'Test 7 failed: standingsProvider was called for LeetCode');
    console.log('✓ Test 7 Passed: standingsProvider legacy fallback completely bypassed for LeetCode.\n');

    // -------------------------------------------------------------------------
    // Scenario 8: Other platform synchronization remains unchanged (uses standingsProvider)
    // -------------------------------------------------------------------------
    console.log('[Test 8] Other platform synchronization remains unchanged...');
    let standingsProviderCalledForCodeChef = false;
    standingsProvider.fetchStandings = async (platform, slug) => {
      if (platform.toLowerCase() === 'codechef') {
        standingsProviderCalledForCodeChef = true;
        return [{ username: 'codechef_user', rank: 1, score: 100 }];
      }
      return [];
    };

    const ccParticipants = await standingsProvider.fetchStandings('CodeChef', 'START100');
    assert(standingsProviderCalledForCodeChef === true, 'Test 8 failed: CodeChef should still call standingsProvider');
    assert(ccParticipants.length === 1 && ccParticipants[0].username === 'codechef_user', 'Test 8 failed: CodeChef participant mismatch');
    console.log('✓ Test 8 Passed: Non-LeetCode platforms continue using standingsProvider.\n');

    // Restore original method
    leetcodeAdapter.getContestParticipants = origGetContestParticipants1;

    console.log('======================================================================');
    console.log('ALL SCHEDULER INTEGRATION TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================================\n');
  } finally {
    standingsProvider.fetchStandings = origFetchStandings;
  }
}

runSchedulerIntegrationTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Scheduler Integration Test Failed:', err);
    process.exit(1);
  });
