const db = require('./config/db');

async function main() {
  await db.initializeDatabase();

  console.log('=== Step 1: Cleaning duplicate AttendanceRecords if any... ===');
  await db.query(`
    DELETE ar1 FROM AttendanceRecords ar1
    INNER JOIN AttendanceRecords ar2 
    WHERE ar1.id < ar2.id AND ar1.user_id = ar2.user_id AND ar1.contest_id = ar2.contest_id
  `);

  console.log('=== Step 2: Adding UNIQUE KEY unique_user_contest (user_id, contest_id) to AttendanceRecords... ===');
  try {
    await db.query("ALTER TABLE AttendanceRecords ADD UNIQUE KEY unique_user_contest (user_id, contest_id)");
    console.log('✓ Successfully added UNIQUE KEY unique_user_contest (user_id, contest_id) to AttendanceRecords!');
  } catch (err) {
    if (err.code === 'ER_DUP_KEYNAME') {
      console.log('Index unique_user_contest already exists.');
    } else {
      console.error('Failed to add index:', err.message);
    }
  }

  const arKeys = await db.query("SHOW INDEX FROM AttendanceRecords");
  console.log('\n=== Updated AttendanceRecords Indexes ===');
  console.log(arKeys.map(k => `${k.Key_name} (Non_unique=${k.Non_unique}) -> ${k.Column_name}`));

  process.exit(0);
}

main();
