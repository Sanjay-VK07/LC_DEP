const path = require('path');
const db = require(path.join(__dirname, '../backend/config/db'));

async function checkMismatches() {
  await db.initializeDatabase();

  const query = `
    SELECT 
      c.contest_id,
      c.title,
      c.slug,
      (SELECT COUNT(*) FROM AttendanceRecords ar WHERE ar.contest_id = c.contest_id) as arCount,
      (SELECT COUNT(*) FROM ContestAttendance ca WHERE ca.contestId = c.contest_id) as caCount
    FROM Contests c
    HAVING arCount != caCount
  `;

  const mismatches = await db.query(query);
  console.log('Mismatched Contests Count:', mismatches.length);
  console.log('Mismatched Contests Details:', mismatches);

  process.exit(0);
}

checkMismatches().catch(err => {
  console.error(err);
  process.exit(1);
});
