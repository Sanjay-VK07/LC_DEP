const db = require('../../config/db');

async function run() {
  await db.initializeDatabase();
  console.log('[FixCols] Modifying attendance_source and attendanceSource to VARCHAR(50)...');

  try {
    await db.query("ALTER TABLE AttendanceRecords MODIFY COLUMN attendance_source VARCHAR(50) DEFAULT 'GRAPHQL'");
    console.log('[FixCols] Updated AttendanceRecords.attendance_source to VARCHAR(50).');
  } catch (err) {
    console.warn('[FixCols Warning] AttendanceRecords.attendance_source:', err.message);
  }

  try {
    await db.query("ALTER TABLE ContestAttendance MODIFY COLUMN attendanceSource VARCHAR(50) DEFAULT 'GRAPHQL'");
    console.log('[FixCols] Updated ContestAttendance.attendanceSource to VARCHAR(50).');
  } catch (err) {
    console.warn('[FixCols Warning] ContestAttendance.attendanceSource:', err.message);
  }

  console.log('[FixCols] Done.');
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
