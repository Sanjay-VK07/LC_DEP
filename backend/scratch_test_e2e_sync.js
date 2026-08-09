const db = require('./config/db');
const { getAdapter } = require('./services/adapters/AdapterFactory');
const StudentContestSyncService = require('./services/StudentContestSyncService');
const ContestAttendanceSyncService = require('./services/ContestAttendanceSyncService');

async function testContest(contestSlug) {
  console.log(`\n===============================================================`);
  console.log(`=== END-TO-END SYNCHRONIZATION TEST FOR: "${contestSlug}" ===`);
  console.log(`===============================================================\n`);

  // 1. Adapter call
  const adapter = getAdapter('LeetCode');
  console.log('--- Step 1: Calling adapter.getContestParticipants ---');
  const participants = await adapter.getContestParticipants(contestSlug);
  console.log(`Adapter Result: ${participants.length} unique scraped participants returned.\n`);

  // 2. StudentContestSyncService (HYBRID / RankingPage provider path)
  console.log('--- Step 2: Running StudentContestSyncService (Live Ranking Page Sync) ---');
  const studentSyncResult = await StudentContestSyncService.syncContestAttendance({
    contestSlug,
    providerType: 'HYBRID',
    actor: 'E2E_TEST'
  });
  console.log('StudentContestSyncService Result:', JSON.stringify(studentSyncResult, null, 2));

  // 3. Database Telemetry Verification
  console.log('\n--- Step 3: Verifying Database Tables ---');
  const lcRows = await db.query(
    'SELECT id, contestSlug, totalParticipants, lastSyncAt, status FROM LiveContests WHERE contestSlug = ?',
    [contestSlug]
  );
  console.log('LiveContests Record:', JSON.stringify(lcRows, null, 2));

  const liveContestId = lcRows[0]?.id;
  if (liveContestId) {
    const caCount = await db.query(
      'SELECT attendanceStatus, COUNT(*) as count FROM ContestAttendance WHERE contestId = ? GROUP BY attendanceStatus',
      [liveContestId]
    );
    console.log('ContestAttendance Summary:', JSON.stringify(caCount, null, 2));
  }

  const cpCount = await db.query(
    'SELECT COUNT(*) as count FROM ContestParticipants WHERE contest_slug = ?',
    [contestSlug]
  );
  console.log('ContestParticipants Count:', JSON.stringify(cpCount, null, 2));
}

async function main() {
  try {
    await db.initializeDatabase();

    const contests = ['weekly-contest-514', 'weekly-contest-512'];
    for (const slug of contests) {
      await testContest(slug);
    }

    console.log('\n===============================================================');
    console.log('=== ALL E2E SYNCHRONIZATION TESTS COMPLETED SUCCESSFULLY ===');
    console.log('===============================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('E2E Sync Test Failed:', err);
    process.exit(1);
  }
}

main();
