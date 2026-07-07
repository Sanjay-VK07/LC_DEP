const db = require('../config/db');

async function run() {
  await db.initializeDatabase();
  
  console.log('=== USERS ===');
  const users = await db.query('SELECT id, name, roll_no, leetcode_username, status, academic_batch FROM Users');
  console.log(JSON.stringify(users, null, 2));

  console.log('=== LIVE CONTESTS ===');
  const liveContests = await db.query('SELECT id, platform, contestSlug, contestName, status FROM LiveContests ORDER BY id DESC LIMIT 5');
  console.log(JSON.stringify(liveContests, null, 2));

  console.log('=== SYNC LOGS (LATEST 5) ===');
  const syncLogs = await db.query('SELECT id, contestId, contest_slug, sync_status, last_page_synced, participants_synced, errors, started_at FROM ContestSyncLog ORDER BY started_at DESC LIMIT 5');
  console.log(JSON.stringify(syncLogs, null, 2));

  console.log('=== CONTEST PARTICIPANTS COUNT ===');
  const participantsCount = await db.query('SELECT contest_slug, COUNT(*) as count FROM ContestParticipants GROUP BY contest_slug');
  console.log(JSON.stringify(participantsCount, null, 2));

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
