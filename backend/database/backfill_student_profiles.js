const db = require('../config/db');
const { syncStudentProfiles } = require('../utils/scheduler');

async function run() {
  try {
    await db.initializeDatabase();
    const connection = await db.getPool().getConnection();
    console.log("Connected to database for student profile backfill.");

    // Fetch all active users
    const [students] = await connection.query(
      "SELECT id, name FROM Users WHERE status = 'active'"
    );
    console.log(`Found ${students.length} active students to sync.`);
    connection.release();

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      console.log(`\n[${i + 1}/${students.length}] Syncing profile for student: ${student.name} (ID: ${student.id})...`);
      try {
        const result = await syncStudentProfiles(student.id);
        console.log(`[Success] Synced student ${student.name}. Result:`, result);
      } catch (e) {
        console.error(`[Error] Failed syncing student ${student.name}:`, e.message);
      }
    }

    console.log("\n==================================================");
    console.log("All student profiles successfully backfilled!");
    console.log("==================================================");

  } catch (err) {
    console.error("Backfill script failed:", err);
  } finally {
    const pool = db.getPool();
    if (pool) await pool.end();
  }
}

run();
