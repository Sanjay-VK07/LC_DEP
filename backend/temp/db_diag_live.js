const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'leetcode_attendance'
  });

  console.log("Connected to database successfully.");

  try {
    // 1. Check for stale/test/retry/crashed contests in Contests
    const [contests] = await connection.query(`
      SELECT contest_id, title, slug, platform 
      FROM Contests 
      WHERE slug LIKE 'crashed-contest-%' 
         OR slug LIKE 'retry-contest-%' 
         OR slug LIKE 'stale-contest-%' 
         OR slug LIKE 'test-contest-%' 
         OR slug LIKE 'test-reg-%'
    `);
    console.log(`Found ${contests.length} test contests in Contests table:`, contests);

    // 2. Check for stale/test/retry/crashed contests in LiveContests
    const [liveContests] = await connection.query(`
      SELECT id, contestName, contestSlug, platform 
      FROM LiveContests 
      WHERE contestSlug LIKE 'crashed-contest-%' 
         OR contestSlug LIKE 'retry-contest-%' 
         OR contestSlug LIKE 'stale-contest-%' 
         OR contestSlug LIKE 'test-contest-%' 
         OR contestSlug LIKE 'test-reg-%'
    `);
    console.log(`Found ${liveContests.length} test contests in LiveContests table:`, liveContests);

    // 3. Check for orphan AttendanceRecords (referencing missing contests)
    const [orphanAR] = await connection.query(`
      SELECT COUNT(*) AS cnt
      FROM AttendanceRecords ar
      LEFT JOIN Contests c ON ar.contest_id = c.contest_id
      WHERE c.contest_id IS NULL
    `);
    console.log(`Orphan AttendanceRecords count: ${orphanAR[0].cnt}`);

    // 4. Check for orphan ContestAttendance (referencing missing LiveContests)
    const [orphanCA] = await connection.query(`
      SELECT COUNT(*) AS cnt
      FROM ContestAttendance ca
      LEFT JOIN LiveContests lc ON ca.contestId = lc.id
      WHERE lc.id IS NULL
    `);
    console.log(`Orphan ContestAttendance count: ${orphanCA[0].cnt}`);

  } catch (err) {
    console.error("Error executing diagnostic query:", err.message);
  }

  await connection.end();
}

run().catch(console.error);
