const db = require('../config/db');

const MIGRATION_NAME = 'robust_unrated_contest_support';

// Helper function to execute queries safely, logging execution and handling idempotency
async function runQuerySafely(sql, params = []) {
  try {
    console.log(`[Rollback] Executing: ${sql.trim().replace(/\s+/g, ' ')}`);
    return await db.query(sql, params);
  } catch (err) {
    const errCode = err.code || '';
    const errNo = err.errno || 0;
    const errMsg = err.message || '';

    // MySQL error codes to safely ignore for idempotence:
    // 1091 (ER_CANT_DROP_FIELD_OR_KEY): Column/key/index does not exist to drop.
    // 1060 (ER_DUP_FIELDNAME): Column already exists.
    // 1061 (ER_DUP_KEYNAME): Key/index already exists.
    // 1051 (ER_BAD_TABLE_ERROR): Table does not exist to drop.
    // 1146 (ER_NO_SUCH_TABLE): Table does not exist.
    const ignorableCodes = [1091, 1060, 1061, 1051, 1146];
    const isIgnorable = ignorableCodes.includes(errNo) || ignorableCodes.includes(errCode) ||
      errMsg.includes('check that column/key exists') ||
      errMsg.includes('already exists') ||
      errMsg.includes('duplicate') ||
      errMsg.includes('unknown table');

    if (isIgnorable) {
      console.log(`[Rollback] Expected structural state already matched. Ignored warning: ${errMsg}`);
      return null;
    }

    console.error(`[Rollback] Database execution error [Code: ${errCode}/${errNo}]: ${errMsg}`);
    throw err;
  }
}

async function run() {
  let pool;
  try {
    await db.initializeDatabase();
    pool = db.getPool();
    
    // Check if the Schema_Migrations table exists and has the migration
    let migrationExists = false;
    try {
      const rows = await db.query(
        "SELECT 1 FROM Schema_Migrations WHERE migration_name = ?",
        [MIGRATION_NAME]
      );
      if (rows && rows.length > 0) {
        migrationExists = true;
      }
    } catch (err) {
      console.log('[Rollback] Schema_Migrations table not found or query failed. Reverting raw schema changes anyway.');
    }

    if (!migrationExists) {
      console.log(`[Rollback] Migration "${MIGRATION_NAME}" was not executed. Nothing to rollback.`);
      if (pool) {
        await pool.end();
        console.log('[Rollback] Connection pool closed.');
      }
      process.exit(0);
    }

    console.log(`[Rollback] Starting rollback of migration "${MIGRATION_NAME}"...`);

    // 1. Drop foreign key constraints first (to allow dropping tables later)
    console.log('[Rollback] Dropping database integrity constraints...');
    await runQuerySafely("ALTER TABLE Contest_Attendance DROP FOREIGN KEY fk_attendance_contest;");
    await runQuerySafely("ALTER TABLE Contest_Attendance DROP FOREIGN KEY fk_attendance_student;");
    await runQuerySafely("ALTER TABLE Contest_Participants DROP FOREIGN KEY fk_participant_contest;");

    // 2. Drop constraints on Contest_Attendance
    await runQuerySafely("ALTER TABLE Contest_Attendance DROP INDEX unique_student_contest_slug;");

    // 3. Re-create old unique constraint on Contest_Attendance
    await runQuerySafely("ALTER TABLE Contest_Attendance ADD UNIQUE KEY unique_student_contest (student_id, contest_name);");

    // 4. Drop tables Contests and Contest_Participants
    await runQuerySafely("DROP TABLE IF EXISTS Contest_Participants;");
    await runQuerySafely("DROP TABLE IF EXISTS Contests;");
    await runQuerySafely("DROP TABLE IF EXISTS Attendance_Migration_Issues;");
    await db.query("DROP TABLE IF EXISTS Migration_Health;");

    // 5. Re-create old anonymous constraint on student_id for Contest_Attendance
    await runQuerySafely("ALTER TABLE Contest_Attendance ADD FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;");

    // 6. Drop columns and indexes from Contest_Attendance
    await runQuerySafely("ALTER TABLE Contest_Attendance DROP INDEX idx_student_contest_slug;");
    await runQuerySafely("ALTER TABLE Contest_Attendance DROP INDEX idx_attendance_status;");
    await runQuerySafely("ALTER TABLE Contest_Attendance DROP INDEX idx_contest_status;");

    await runQuerySafely("ALTER TABLE Contest_Attendance DROP COLUMN contest_slug;");
    await runQuerySafely("ALTER TABLE Contest_Attendance DROP COLUMN contest_status;");
    await runQuerySafely("ALTER TABLE Contest_Attendance DROP COLUMN attendance_status;");
    await runQuerySafely("ALTER TABLE Contest_Attendance DROP COLUMN attendance_source;");
    await runQuerySafely("ALTER TABLE Contest_Attendance DROP COLUMN participation_verified;");
    await runQuerySafely("ALTER TABLE Contest_Attendance DROP COLUMN verification_method;");
    await runQuerySafely("ALTER TABLE Contest_Attendance DROP COLUMN score;");

    // 7. Drop columns and indexes from Contest_Summary
    await runQuerySafely("ALTER TABLE Contest_Summary DROP INDEX idx_student_summary;");
    await runQuerySafely("ALTER TABLE Contest_Summary DROP COLUMN rated_contests;");
    await runQuerySafely("ALTER TABLE Contest_Summary DROP COLUMN unrated_contests;");

    // 8. Delete migration record
    await runQuerySafely("DELETE FROM Schema_Migrations WHERE migration_name = ?;", [MIGRATION_NAME]);

    console.log(`[Rollback] Rollback of "${MIGRATION_NAME}" completed successfully.`);
    
    if (pool) {
      await pool.end();
      console.log('[Rollback] Connection pool closed.');
    }
    process.exit(0);
  } catch (err) {
    console.error('[Rollback] Rollback failed:', err.message);
    if (pool) {
      try {
        await pool.end();
        console.log('[Rollback] Connection pool closed after failure.');
      } catch (poolErr) {
        console.error('[Rollback] Error closing pool:', poolErr.message);
      }
    }
    process.exit(1);
  }
}

run();
