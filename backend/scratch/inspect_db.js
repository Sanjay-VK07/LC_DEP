const db = require('../config/db');

async function run() {
  await db.initializeDatabase();
  
  console.log('=== USERS ===');
  const users = await db.query('SELECT id, name, roll_no, leetcode_username, status, academic_batch FROM Users');
  console.log(users);

  console.log('=== CONTESTS ===');
  const contests = await db.query('SELECT contest_id, title, slug, platform FROM Contests');
  console.log(contests);

  console.log('=== LIVE CONTESTS ===');
  const liveContests = await db.query('SELECT id, platform, contestSlug, contestName, status FROM LiveContests');
  console.log(liveContests);

  console.log('=== SYNC LOGS ===');
  const syncLogs = await db.query('SELECT id, contestId, contest_slug, sync_status, last_page_synced, participants_synced, errors FROM ContestSyncLog');
  console.log(syncLogs);

  console.log('=== CONTEST PARTICIPANTS ===');
  const participantsCount = await db.query('SELECT contest_slug, COUNT(*) as count FROM ContestParticipants GROUP BY contest_slug');
  console.log(participantsCount);

  console.log('=== CONTEST ATTENDANCE ===');
  const attendance = await db.query('SELECT id, contestId, studentId, username, attendanceStatus, `rank`, score FROM ContestAttendance');
  console.log(attendance);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
