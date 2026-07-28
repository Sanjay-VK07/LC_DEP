const db = require('../../config/db');

async function run() {
  await db.initializeDatabase();
  console.log('[RunAlter] Running table alterations...');

  const addCol = async (table, col, sqlDef) => {
    try {
      const cols = await db.query(`SHOW COLUMNS FROM ${table}`);
      const names = cols.map(c => c.Field.toLowerCase());
      if (!names.includes(col.toLowerCase())) {
        console.log(`[RunAlter] Adding ${col} to ${table}...`);
        await db.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${sqlDef}`);
        console.log(`[RunAlter] Added ${col} to ${table}.`);
      } else {
        console.log(`[RunAlter] Column ${col} already exists in ${table}.`);
      }
    } catch (err) {
      console.warn(`[RunAlter Warning] ${table}.${col}:`, err.message);
    }
  };

  await addCol('AttendanceRecords', 'sync_provider', "ENUM('GRAPHQL', 'CSV', 'LEGACY', 'HYBRID', 'MANUAL') DEFAULT 'GRAPHQL'");
  await addCol('AttendanceRecords', 'last_verified', "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
  await addCol('AttendanceRecords', 'verification_method', "VARCHAR(100) DEFAULT 'GRAPHQL_HISTORY'");
  await addCol('AttendanceRecords', 'sync_status', "VARCHAR(50) DEFAULT 'COMPLETED'");
  await addCol('AttendanceRecords', 'upstream_error', "TEXT DEFAULT NULL");

  await addCol('ContestAttendance', 'syncProvider', "ENUM('GRAPHQL', 'CSV', 'LEGACY', 'HYBRID', 'MANUAL') DEFAULT 'GRAPHQL'");
  await addCol('ContestAttendance', 'attendanceSource', "ENUM('GRAPHQL', 'CSV_IMPORT', 'MANUAL', 'UNKNOWN') DEFAULT 'GRAPHQL'");
  await addCol('ContestAttendance', 'lastVerified', "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
  await addCol('ContestAttendance', 'verificationMethod', "VARCHAR(100) DEFAULT 'GRAPHQL_HISTORY'");
  await addCol('ContestAttendance', 'syncStatus', "VARCHAR(50) DEFAULT 'COMPLETED'");
  await addCol('ContestAttendance', 'upstreamError', "TEXT DEFAULT NULL");

  console.log('[RunAlter] Done.');
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
