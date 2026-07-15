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
    // Begin Transaction
    await connection.beginTransaction();
    console.log("Database transaction started.");

    // Disable foreign key checks for clean deletions
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    // 1. Delete stale/test/retry/crashed contests from Contests
    const [delContests] = await connection.query(`
      DELETE FROM Contests 
      WHERE slug LIKE 'crashed-contest-%' 
         OR slug LIKE 'retry-contest-%' 
         OR slug LIKE 'stale-contest-%' 
         OR slug LIKE 'test-contest-%' 
         OR slug LIKE 'test-reg-%'
    `);
    console.log(`Deleted ${delContests.affectedRows || 0} test contests from Contests table.`);

    // 2. Delete stale/test/retry/crashed contests from LiveContests
    const [delLive] = await connection.query(`
      DELETE FROM LiveContests 
      WHERE contestSlug LIKE 'crashed-contest-%' 
         OR contestSlug LIKE 'retry-contest-%' 
         OR contestSlug LIKE 'stale-contest-%' 
         OR contestSlug LIKE 'test-contest-%' 
         OR contestSlug LIKE 'test-reg-%'
    `);
    console.log(`Deleted ${delLive.affectedRows || 0} test contests from LiveContests table.`);

    // 3. Delete orphan AttendanceRecords
    const [delAR] = await connection.query(`
      DELETE FROM AttendanceRecords 
      WHERE contest_id NOT IN (SELECT contest_id FROM Contests)
    `);
    console.log(`Deleted ${delAR.affectedRows || 0} orphan AttendanceRecords.`);

    // 4. Delete orphan ContestParticipants
    const [delCP] = await connection.query(`
      DELETE FROM ContestParticipants 
      WHERE contest_slug NOT IN (SELECT slug FROM Contests)
    `);
    console.log(`Deleted ${delCP.affectedRows || 0} orphan ContestParticipants.`);

    // 5. Delete orphan ContestLeaderboardSnapshots
    const [delCLS] = await connection.query(`
      DELETE FROM ContestLeaderboardSnapshots 
      WHERE contest_slug NOT IN (SELECT slug FROM Contests)
    `);
    console.log(`Deleted ${delCLS.affectedRows || 0} orphan ContestLeaderboardSnapshots.`);

    // 6. Delete orphan ContestSyncLog (by slug)
    const [delCSL] = await connection.query(`
      DELETE FROM ContestSyncLog 
      WHERE contest_slug NOT IN (SELECT slug FROM Contests)
    `);
    console.log(`Deleted ${delCSL.affectedRows || 0} orphan ContestSyncLog entries.`);

    // 7. Delete orphan ContestAttendance (by live contest id)
    const [delCA] = await connection.query(`
      DELETE FROM ContestAttendance 
      WHERE contestId NOT IN (SELECT id FROM LiveContests)
    `);
    console.log(`Deleted ${delCA.affectedRows || 0} orphan ContestAttendance.`);

    // Re-enable foreign key checks
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    await connection.commit();
    console.log("Transaction committed successfully.");

    // --- REPAIR FOREIGN KEYS & PREVENT FUTURE ORPHANS ---
    console.log("Applying foreign key constraints to prevent future orphans...");

    // Helper to drop and add constraints safely
    const repairConstraint = async (table, constraintName, alterSql) => {
      try {
        await connection.query(`ALTER TABLE ${table} DROP FOREIGN KEY ${constraintName}`);
        console.log(`Dropped existing constraint ${constraintName} on ${table}.`);
      } catch (err) {
        // Ignore if constraint doesn't exist
      }
      try {
        await connection.query(alterSql);
        console.log(`Successfully added constraint ${constraintName} on ${table}.`);
      } catch (err) {
        console.error(`Failed to add constraint ${constraintName} on ${table}:`, err.message);
      }
    };

    // A. AttendanceRecords -> Contests
    await repairConstraint(
      'AttendanceRecords',
      'fk_attendance_records_contest',
      'ALTER TABLE AttendanceRecords ADD CONSTRAINT fk_attendance_records_contest FOREIGN KEY (contest_id) REFERENCES Contests(contest_id) ON DELETE CASCADE'
    );

    // B. ContestParticipants -> Contests
    await repairConstraint(
      'ContestParticipants',
      'fk_cp_contest_slug',
      'ALTER TABLE ContestParticipants ADD CONSTRAINT fk_cp_contest_slug FOREIGN KEY (contest_slug) REFERENCES Contests(slug) ON DELETE CASCADE'
    );

    // C. ContestLeaderboardSnapshots -> Contests
    await repairConstraint(
      'ContestLeaderboardSnapshots',
      'fk_cls_contest_slug',
      'ALTER TABLE ContestLeaderboardSnapshots ADD CONSTRAINT fk_cls_contest_slug FOREIGN KEY (contest_slug) REFERENCES Contests(slug) ON DELETE CASCADE'
    );

    // D. ContestSyncLog -> Contests
    await repairConstraint(
      'ContestSyncLog',
      'fk_csl_contest_slug',
      'ALTER TABLE ContestSyncLog ADD CONSTRAINT fk_csl_contest_slug FOREIGN KEY (contest_slug) REFERENCES Contests(slug) ON DELETE CASCADE'
    );

    // E. ContestAttendance -> LiveContests
    await repairConstraint(
      'ContestAttendance',
      'fk_attendance_live_contest',
      'ALTER TABLE ContestAttendance ADD CONSTRAINT fk_attendance_live_contest FOREIGN KEY (contestId) REFERENCES LiveContests(id) ON DELETE CASCADE'
    );

    console.log("Database integrity repair completed successfully.");

  } catch (err) {
    await connection.rollback();
    console.error("Cleanup error:", err.message);
  }

  await connection.end();
}

run().catch(console.error);
