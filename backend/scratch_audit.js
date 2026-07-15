const db = require('./config/db');

async function main() {
  try {
    await db.initializeDatabase();
    
    const mismatches = await db.query(`
      SELECT ar.id, ar.user_id, ar.contest_id as ar_contest_id, ar.contest_slug as ar_slug, 
             c.contest_id as c_contest_id, c.slug as c_slug, u.name
      FROM AttendanceRecords ar
      JOIN Contests c ON ar.contest_slug = c.slug
      JOIN Users u ON ar.user_id = u.id
      WHERE ar.contest_id != c.contest_id
    `);

    console.log(`Total mismatched AttendanceRecords: ${mismatches.length}`);
    if (mismatches.length > 0) {
      console.log("Sample of mismatches:");
      console.log(mismatches.slice(0, 15));
    }

    process.exit(0);
  } catch (err) {
    console.error("Error executing audit:", err);
    process.exit(1);
  }
}

main();
