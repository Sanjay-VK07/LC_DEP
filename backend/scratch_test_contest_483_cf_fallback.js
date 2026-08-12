const db = require('./config/db');
const { getAdapter } = require('./services/adapters/AdapterFactory');
const adapter = getAdapter('leetcode');

async function testContest483CloudflareFallback() {
  console.log('======================================================================');
  console.log('Testing weekly-contest-483 Cloudflare 403 -> GraphQL / Alfa API Fallback');
  console.log('======================================================================\n');

  await db.initializeDatabase();

  // Simulate Cloudflare 403 on live leaderboard API
  adapter._fetchFullLeaderboard = async () => {
    const err = new Error('HTTP 403 Forbidden Cloudflare challenge page (cf-mitigated: challenge)');
    err.code = 'CLOUDFLARE_BLOCK';
    err.status = 403;
    err.isCloudflare = true;
    err.retryable = false;
    throw err;
  };

  const mockStudents = Array.from({ length: 987 }, (_, i) => ({
    leetcode_username: `student_${i + 1}`
  }));

  try {
    console.log('[Acceptance Test] Initiating contest sync for "weekly-contest-483" with 987 students...');
    const result = await adapter.getContestParticipants('weekly-contest-483', {
      bypassCache: true,
      students: mockStudents
    });

    console.log('\n----------------------------------------------------------------------');
    console.log('Sync Result Summary:');
    console.log('Status:', result.syncStatus);
    console.log('Source:', result.source);
    console.log('Participants Count:', result.length || 0);
    console.log('Resolved Count:', result.resolvedCount || 0);
    console.log('Unresolved Count:', result.unresolvedCount || 0);
    console.log('----------------------------------------------------------------------\n');
  } catch (err) {
    console.log('\n----------------------------------------------------------------------');
    console.log('Sync Error State:');
    console.log('Code:', err.code || err.syncStatus);
    console.log('Message:', err.message);
    console.log('----------------------------------------------------------------------\n');
  }
}

testContest483CloudflareFallback()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Acceptance Test Error:', err);
    process.exit(1);
  });
