const db = require('./config/db');
const StudentContestSyncService = require('./services/StudentContestSyncService');

async function main() {
  await db.initializeDatabase();

  const targetContests = [
    'weekly-contest-512',
    'weekly-contest-513',
    'weekly-contest-514',
    'biweekly-contest-188',
    'biweekly-contest-189'
  ];

  console.log('=== Step 4 Audit: Verifying Contests Sync ===\n');

  for (const slug of targetContests) {
    console.log(`---> Auditing Contest: "${slug}"`);

    // Fetch LiveContests and Contests IDs
    const lc = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
    const c = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);

    const liveId = lc[0]?.id;
    const realId = c[0]?.contest_id;

    if (!liveId || !realId) {
      console.log(`    Triggering sync to populate missing contest metadata for "${slug}"...`);
      await StudentContestSyncService.syncContestAttendance({ contestSlug: slug });
    }

    // Re-query IDs
    const lc2 = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
    const c2 = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
    const lId = lc2[0]?.id;
    const rId = c2[0]?.contest_id;

    // Check AttendanceRecords
    const arStats = await db.query(
      "SELECT attendance_status, COUNT(*) as count FROM AttendanceRecords WHERE contest_id = ? GROUP BY attendance_status",
      [rId]
    );

    // Check ContestAttendance
    const caStats = await db.query(
      "SELECT attendanceStatus, COUNT(*) as count FROM ContestAttendance WHERE contestId = ? GROUP BY attendanceStatus",
      [lId]
    );

    // Check ContestParticipants
    const cpStats = await db.query(
      "SELECT COUNT(*) as count FROM ContestParticipants WHERE contest_slug = ?",
      [slug]
    );

    // Check ContestSnapshots
    const csStats = await db.query(
      "SELECT participants, attendancePercentage FROM ContestSnapshots WHERE contestId = ? ORDER BY snapshotTime DESC LIMIT 1",
      [lId]
    );

    // Check ContestSyncLog
    const cslStats = await db.query(
      "SELECT total_requests, participantsFetched FROM ContestSyncLog WHERE contestId = ? ORDER BY started_at DESC LIMIT 1",
      [lId]
    );

    console.log(`    ContestID (Contests.contest_id)  : ${rId}`);
    console.log(`    LiveContestID (LiveContests.id)  : ${lId}`);
    console.log(`    AttendanceRecords Counts        :`, arStats);
    console.log(`    ContestAttendance Counts        :`, caStats);
    console.log(`    ContestParticipants Cached Count:`, cpStats[0]?.count || 0);
    console.log(`    Latest Snapshot Metrics         :`, csStats[0] || 'No snapshot');
    console.log(`    Latest Sync Log Telemetry       :`, cslStats[0] || 'No sync log');
    console.log('------------------------------------------------------------\n');
  }

  process.exit(0);
}

main();
