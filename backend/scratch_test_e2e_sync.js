const db = require('./config/db');
const { getAdapter } = require('./services/adapters/AdapterFactory');
const ContestAttendanceSyncService = require('./services/ContestAttendanceSyncService');

async function testE2ESync() {
  console.log('=== END-TO-END SYNCHRONIZATION VERIFICATION TEST ===\n');

  await db.initializeDatabase();

  const contestSlug = 'weekly-contest-512';
  console.log(`Testing sync for contest: "${contestSlug}"...`);

  // 1. Run Adapter getContestParticipants
  const adapter = getAdapter('LeetCode');
  console.log('\n--- Step 1: Calling adapter.getContestParticipants ---');
  const participants = await adapter.getContestParticipants(contestSlug);

  console.log(`\nAdapter Result: ${participants.length} participants returned.`);
  if (participants.length > 0) {
    console.log('Sample participant:', JSON.stringify(participants[0], null, 2));
  } else {
    console.warn('WARNING: 0 participants returned!');
  }

  // 2. Run ContestAttendanceSyncService
  console.log('\n--- Step 2: Running ContestAttendanceSyncService ---');
  const syncResult = await ContestAttendanceSyncService.syncContestAttendance(contestSlug);
  console.log('ContestAttendanceSyncService Result:', JSON.stringify(syncResult, null, 2));

  // 3. Database Telemetry Verification
  console.log('\n--- Step 3: Verifying Database Tables ---');
  
  const lcRows = await db.query('SELECT id, contestSlug, totalParticipants, lastSyncAt FROM LiveContests WHERE contestSlug = ?', [contestSlug]);
  const liveContestId = lcRows[0]?.id;

  const caCount = await db.query('SELECT COUNT(*) as count, attendanceStatus FROM ContestAttendance WHERE contestId = ? GROUP BY attendanceStatus', [liveContestId]);
  console.log('ContestAttendance Summary:', JSON.stringify(caCount, null, 2));

  const cpCount = await db.query('SELECT COUNT(*) as count FROM ContestParticipants WHERE contest_slug = ?', [contestSlug]);
  console.log('ContestParticipants Count:', JSON.stringify(cpCount, null, 2));

  const csCount = await db.query('SELECT COUNT(*) as count FROM ContestSnapshots WHERE contestId = ?', [liveContestId]);
  console.log('ContestSnapshots Count:', JSON.stringify(csCount, null, 2));

  const cslCount = await db.query('SELECT COUNT(*) as count FROM ContestSyncLog WHERE contestId = ?', [liveContestId]);
  console.log('ContestSyncLog Count:', JSON.stringify(cslCount, null, 2));

  process.exit(0);
}

testE2ESync().catch(err => {
  console.error('E2E Sync Error:', err);
  process.exit(1);
});
