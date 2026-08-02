const db = require('./config/db');

async function verifyMapping() {
  try {
    await db.initializeDatabase();

    console.log('=== 1. ContestAttendance contestId Values ===');
    const caRows = await db.query('SELECT DISTINCT contestId FROM ContestAttendance LIMIT 20');
    console.log(JSON.stringify(caRows, null, 2));

    console.log('\n=== 2. LiveContests Rows ===');
    const lcRows = await db.query('SELECT id, contestSlug, contestName, startTime FROM LiveContests ORDER BY id DESC LIMIT 20');
    console.log(JSON.stringify(lcRows, null, 2));

    console.log('\n=== 3. Contests Rows ===');
    const cRows = await db.query('SELECT contest_id, slug, title, start_time FROM Contests ORDER BY contest_id DESC LIMIT 20');
    console.log(JSON.stringify(cRows, null, 2));

    console.log('\n=== 4. Cross Join / Relationship Verification ===');
    const joinRows = await db.query(`
      SELECT 
        ca.contestId as ca_contestId, 
        COUNT(ca.id) as ca_count,
        lc.id as lc_id, 
        lc.contestSlug as lc_slug, 
        c.contest_id as c_contest_id, 
        c.slug as c_slug
      FROM ContestAttendance ca
      LEFT JOIN LiveContests lc ON ca.contestId = lc.id
      LEFT JOIN Contests c ON ca.contestId = c.contest_id
      GROUP BY ca.contestId, lc.id, lc.contestSlug, c.contest_id, c.slug
    `);
    console.log(JSON.stringify(joinRows, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Verification Error:', err.message);
    process.exit(1);
  }
}

verifyMapping();
