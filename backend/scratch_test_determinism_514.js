const db = require('./config/db');
const StudentContestSyncService = require('./services/StudentContestSyncService');
const NetworkService = require('./utils/networkService');

async function runSingleSync(runNumber) {
  console.log(`\n===============================================================`);
  console.log(`=== RUN ${runNumber}/3: SYNCHRONIZING weekly-contest-514 (CONCURRENCY=5) ===`);
  console.log(`===============================================================\n`);

  process.env.LEETCODE_PAGE_CONCURRENCY = '5';
  process.env.LEETCODE_PAGE_DELAY_MS = '50';
  process.env.LEETCODE_MAX_PAGES_LIMIT = '20'; // Fetch fixed 20 pages per run for fast verification

  let networkRequestCount = 0;
  const originalRequest = NetworkService.request;
  NetworkService.request = async function(...args) {
    networkRequestCount++;
    return originalRequest.apply(this, args);
  };

  const startTime = Date.now();
  let syncResult;
  try {
    syncResult = await StudentContestSyncService.syncContestAttendance({
      contestSlug: 'weekly-contest-514',
      providerType: 'HYBRID',
      actor: `DETERMINISM_TEST_RUN_${runNumber}`
    });
  } finally {
    NetworkService.request = originalRequest;
  }

  // Retrieve metrics from DB
  const liveRows = await db.query(
    "SELECT id, totalParticipants FROM LiveContests WHERE contestSlug = 'weekly-contest-514'"
  );
  const liveContestId = liveRows[0]?.id;
  const downloadedParticipants = syncResult.scrapedParticipantCount || liveRows[0]?.totalParticipants || 0;

  const caStats = await db.query(
    `SELECT 
       SUM(CASE WHEN attendanceStatus IN ('Present', 'PRESENT', 'Participating') THEN 1 ELSE 0 END) as present,
       SUM(CASE WHEN attendanceStatus IN ('Absent', 'ABSENT') THEN 1 ELSE 0 END) as absent
     FROM ContestAttendance 
     WHERE contestId = ? AND studentId IN (SELECT id FROM Users WHERE status = 'active')`,
    [liveContestId]
  );

  const present = parseInt(caStats[0]?.present || 0, 10);
  const absent = parseInt(caStats[0]?.absent || 0, 10);
  const apiRequests = networkRequestCount;
  const durationMs = Date.now() - startTime;

  console.log(`Run ${runNumber} Complete in ${durationMs}ms:`);
  console.log(`  downloadedParticipants: ${downloadedParticipants}`);
  console.log(`  present:                ${present}`);
  console.log(`  absent:                 ${absent}`);
  console.log(`  apiRequests:            ${apiRequests}`);

  return {
    run: runNumber,
    downloadedParticipants,
    present,
    absent,
    apiRequests,
    durationMs
  };
}

async function main() {
  try {
    await db.initializeDatabase();

    const runs = [];
    for (let i = 1; i <= 3; i++) {
      const res = await runSingleSync(i);
      runs.push(res);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n========================================================================');
    console.log('=== DETERMINISM VERIFICATION TABLE: 3 CONSECUTIVE RUNS (CONCURRENCY=5) ===');
    console.log('========================================================================\n');

    console.table(runs.map(r => ({
      'Run': `Run ${r.run}`,
      'Downloaded Participants': r.downloadedParticipants,
      'Present': r.present,
      'Absent': r.absent,
      'API Requests': r.apiRequests,
      'Duration (ms)': r.durationMs
    })));

    const first = runs[0];
    const isDeterministic = runs.every(r => 
      r.downloadedParticipants === first.downloadedParticipants &&
      r.present === first.present &&
      r.absent === first.absent &&
      r.apiRequests === first.apiRequests
    );

    if (isDeterministic) {
      console.log('\n✓ VERIFICATION SUCCESSFUL: All 3 consecutive runs returned IDENTICAL results!\n');
      process.exit(0);
    } else {
      console.error('\n❌ VERIFICATION FAILED: Metrics differ across runs. Fix is incomplete.\n');
      process.exit(1);
    }
  } catch (err) {
    console.error('Determinism Test Error:', err);
    process.exit(1);
  }
}

main();
