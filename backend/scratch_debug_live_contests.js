require('dotenv').config();
const db = require('./config/db');

async function main() {
  await db.initializeDatabase();
  const rows = await db.query("SELECT id, contestName, contestSlug, totalParticipants, lastSyncAt, status FROM LiveContests WHERE contestSlug = 'weekly-contest-514' ORDER BY id DESC");
  console.log('LiveContests rows for weekly-contest-514:', rows);

  for (const r of rows) {
    const att = await db.query("SELECT COUNT(*) as count, attendanceStatus FROM ContestAttendance WHERE contestId = ? GROUP BY attendanceStatus", [r.id]);
    console.log(`Contest ID #${r.id} attendance stats:`, att);
  }

  process.exit(0);
}

main();
