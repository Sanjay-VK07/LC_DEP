const db = require('./config/db');

async function main() {
  await db.initializeDatabase();
  const slug = 'weekly-contest-512';

  const lc = await db.query("SELECT id, contestSlug, totalParticipants, lastSyncAt FROM LiveContests WHERE contestSlug = ?", [slug]);
  console.log('=== LiveContests ===');
  console.log(JSON.stringify(lc, null, 2));

  if (lc.length > 0) {
    const liveId = lc[0].id;

    const ca = await db.query("SELECT attendanceStatus, COUNT(*) as count FROM ContestAttendance WHERE contestId = ? GROUP BY attendanceStatus", [liveId]);
    console.log('\n=== ContestAttendance ===');
    console.log(JSON.stringify(ca, null, 2));

    const cp = await db.query("SELECT COUNT(*) as count FROM ContestParticipants WHERE contest_slug = ?", [slug]);
    console.log('\n=== ContestParticipants ===');
    console.log(JSON.stringify(cp, null, 2));

    const cs = await db.query("SELECT * FROM ContestSnapshots WHERE contestId = ?", [liveId]);
    console.log('\n=== ContestSnapshots ===');
    console.log(JSON.stringify(cs, null, 2));

    const csl = await db.query("SELECT * FROM ContestSyncLog WHERE contestId = ?", [liveId]);
    console.log('\n=== ContestSyncLog ===');
    console.log(JSON.stringify(csl, null, 2));
  }

  process.exit(0);
}

main();
