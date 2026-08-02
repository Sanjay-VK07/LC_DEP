const db = require('./config/db');

async function main() {
  await db.initializeDatabase();

  const arCols = await db.query("SHOW COLUMNS FROM AttendanceRecords");
  console.log('=== AttendanceRecords Columns ===');
  console.log(arCols.map(c => `${c.Field} (${c.Type})`));

  const arKeys = await db.query("SHOW INDEX FROM AttendanceRecords");
  console.log('\n=== AttendanceRecords Indexes ===');
  console.log(arKeys.map(k => `${k.Key_name} -> ${k.Column_name}`));

  const caCols = await db.query("SHOW COLUMNS FROM ContestAttendance");
  console.log('\n=== ContestAttendance Columns ===');
  console.log(caCols.map(c => `${c.Field} (${c.Type})`));

  const caKeys = await db.query("SHOW INDEX FROM ContestAttendance");
  console.log('\n=== ContestAttendance Indexes ===');
  console.log(caKeys.map(k => `${k.Key_name} -> ${k.Column_name}`));

  process.exit(0);
}

main();
