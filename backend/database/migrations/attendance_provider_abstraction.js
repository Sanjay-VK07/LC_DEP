const db = require('../../config/db');

async function up() {
  console.log('[Migration] Starting attendance_provider_abstraction migration...');
  try {
    await db.initializeDatabase();

    // 1. Ensure Schema_Migrations table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS Schema_Migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    // Helper to safely add column if missing
    const addColIfMissing = async (table, column, definition) => {
      const cols = await db.query(`SHOW COLUMNS FROM ${table}`);
      const colNames = cols.map(c => c.Field.toLowerCase());
      if (!colNames.includes(column.toLowerCase())) {
        console.log(`[Migration] Adding column ${column} to table ${table}...`);
        await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    };

    // Add columns to ContestAttendance
    await addColIfMissing('ContestAttendance', 'syncProvider', "ENUM('GRAPHQL', 'CSV', 'LEGACY', 'HYBRID', 'MANUAL') DEFAULT 'GRAPHQL'");
    await addColIfMissing('ContestAttendance', 'attendanceSource', "ENUM('GRAPHQL', 'CSV_IMPORT', 'MANUAL', 'UNKNOWN') DEFAULT 'GRAPHQL'");
    await addColIfMissing('ContestAttendance', 'lastVerified', "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
    await addColIfMissing('ContestAttendance', 'verificationMethod', "VARCHAR(100) DEFAULT 'GRAPHQL_HISTORY'");
    await addColIfMissing('ContestAttendance', 'syncStatus', "VARCHAR(50) DEFAULT 'COMPLETED'");
    await addColIfMissing('ContestAttendance', 'upstreamError', "TEXT DEFAULT NULL");

    // Add columns to AttendanceRecords
    await addColIfMissing('AttendanceRecords', 'sync_provider', "ENUM('GRAPHQL', 'CSV', 'LEGACY', 'HYBRID', 'MANUAL') DEFAULT 'GRAPHQL'");
    await addColIfMissing('AttendanceRecords', 'attendance_source', "ENUM('GRAPHQL', 'CSV_IMPORT', 'MANUAL', 'UNKNOWN') DEFAULT 'GRAPHQL'");
    await addColIfMissing('AttendanceRecords', 'last_verified', "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
    await addColIfMissing('AttendanceRecords', 'verification_method', "VARCHAR(100) DEFAULT 'GRAPHQL_HISTORY'");
    await addColIfMissing('AttendanceRecords', 'sync_status', "VARCHAR(50) DEFAULT 'COMPLETED'");
    await addColIfMissing('AttendanceRecords', 'upstream_error', "TEXT DEFAULT NULL");

    // Record migration execution
    await db.query(`
      INSERT INTO Schema_Migrations (migration_name) 
      VALUES ('attendance_provider_abstraction')
      ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
    `);

    console.log('[Migration] Migration "attendance_provider_abstraction" completed successfully.');
  } catch (err) {
    console.error('[Migration Error] Failed executing attendance_provider_abstraction migration:', err.message);
    throw err;
  }
}

if (require.main === module) {
  up().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { up };
