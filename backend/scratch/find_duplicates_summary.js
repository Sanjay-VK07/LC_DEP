const db = require('../config/db');

async function run() {
  await db.initializeDatabase();

  console.log('=== GENERAL COUNTS ===');
  const [cCount] = await db.query('SELECT COUNT(*) as count FROM Contests');
  const [lcCount] = await db.query('SELECT COUNT(*) as count FROM LiveContests');
  console.log('Contests Table Count:', cCount.count);
  console.log('LiveContests Table Count:', lcCount.count);

  console.log('\n=== DUPLICATES IN CONTESTS BY SLUG ===');
  const contestsDups = await db.query(`
    SELECT slug, COUNT(*) as count 
    FROM Contests 
    GROUP BY slug 
    HAVING count > 1
  `);
  console.log('Duplicate Slugs in Contests:', contestsDups);

  console.log('\n=== DUPLICATES IN LIVE CONTESTS BY SLUG ===');
  const liveContestsDups = await db.query(`
    SELECT contestSlug, COUNT(*) as count 
    FROM LiveContests 
    GROUP BY contestSlug 
    HAVING count > 1
  `);
  console.log('Duplicate Slugs in LiveContests:', liveContestsDups);

  console.log('\n=== TEST/DEMO CONTESTS IN CONTESTS ===');
  const testContests = await db.query(`
    SELECT contest_id, title, slug, platform 
    FROM Contests 
    WHERE slug LIKE '%test%' OR slug LIKE '%demo%' OR title LIKE '%test%' OR title LIKE '%demo%'
  `);
  console.log('Test Contests found:', testContests.length);
  for (const tc of testContests) {
    const [attCount] = await db.query('SELECT COUNT(*) as count FROM AttendanceRecords WHERE contest_id = ?', [tc.contest_id]);
    const [partCount] = await db.query('SELECT COUNT(*) as count FROM Registrations WHERE contest_id = ?', [tc.contest_id]);
    console.log(`- ID: ${tc.contest_id}, Slug: "${tc.slug}", Platform: ${tc.platform}, Linked Attendance: ${attCount.count}, Linked Registrations: ${partCount.count}`);
  }

  console.log('\n=== TEST/DEMO CONTESTS IN LIVE CONTESTS ===');
  const testLiveContests = await db.query(`
    SELECT id, contestSlug, contestName, platform 
    FROM LiveContests 
    WHERE contestSlug LIKE '%test%' OR contestSlug LIKE '%demo%' OR contestName LIKE '%test%' OR contestName LIKE '%demo%'
  `);
  console.log('Test Live Contests found:', testLiveContests.length);
  for (const tlc of testLiveContests) {
    const [attCount] = await db.query('SELECT COUNT(*) as count FROM ContestAttendance WHERE contestId = ?', [tlc.id]);
    const [partCount] = await db.query('SELECT COUNT(*) as count FROM ContestParticipants WHERE contest_slug = ?', [tlc.contestSlug]);
    const [snapCount] = await db.query('SELECT COUNT(*) as count FROM ContestLeaderboardSnapshots WHERE contest_slug = ?', [tlc.contestSlug]);
    const [logCount] = await db.query('SELECT COUNT(*) as count FROM ContestSyncLog WHERE contestId = ?', [tlc.id]);
    console.log(`- ID: ${tlc.id}, Slug: "${tlc.contestSlug}", Platform: ${tlc.platform}, Linked Attendance: ${attCount.count}, Linked Participants: ${partCount.count}, Snapshots: ${snapCount.count}, Sync Logs: ${logCount.count}`);
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
