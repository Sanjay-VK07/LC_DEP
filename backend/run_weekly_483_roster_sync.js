process.env.LEETCODE_PAGE_CONCURRENCY = '15';
process.env.LEETCODE_PAGE_DELAY_MS = '20';
process.env.LEETCODE_LEADERBOARD_REQUESTS_PER_MINUTE = '6000';

require('dotenv').config();
process.env.LEETCODE_PAGE_CONCURRENCY = '15';
process.env.LEETCODE_PAGE_DELAY_MS = '20';
process.env.LEETCODE_LEADERBOARD_REQUESTS_PER_MINUTE = '6000';

const db = require('./config/db');
const StudentContestSyncService = require('./services/StudentContestSyncService');

async function main() {
  console.log('============================================================');
  console.log('STARTING FULL 987-STUDENT ROSTER SYNC FOR weekly-contest-483');
  console.log('============================================================\n');

  const startTime = Date.now();
  await db.initializeDatabase();

  const totalStudentsRes = await db.query("SELECT COUNT(*) as cnt FROM Users WHERE status = 'active'");
  const totalRoster = totalStudentsRes[0]?.cnt || 0;
  console.log(`Total active students in database roster: ${totalRoster}\n`);

  try {
    const result = await StudentContestSyncService.syncContestAttendance({
      contestSlug: 'weekly-contest-483',
      providerType: 'HYBRID',
      actor: 'ADMIN_ROSTER_SYNC',
      bypassCache: true
    });

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n============================================================');
    console.log('FULL ROSTER SYNC COMPLETE FOR weekly-contest-483');
    console.log('============================================================');
    console.log(`Total Roster Students Processed : ${result.processedStudents}`);
    console.log(`Present Count                  : ${result.presentCount}`);
    console.log(`Absent Count                   : ${result.absentCount}`);
    console.log(`Unknown / Pending Count        : ${result.unknownCount}`);
    console.log(`Blocked Count                  : ${result.blockedCount}`);
    console.log(`Total Scraped Participants     : ${result.scrapedParticipantCount}`);
    const attendancePct = result.processedStudents > 0 
      ? ((result.presentCount / result.processedStudents) * 100).toFixed(2)
      : '0.00';
    console.log(`Attendance Rate                : ${attendancePct}%`);
    console.log(`Duration                       : ${elapsedSec}s`);
    console.log('============================================================\n');
  } catch (err) {
    console.error('Error during roster sync:', err);
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
