const db = require('../../config/db');

async function run() {
  await db.initializeDatabase();
  console.log('[Dedup] Scanning AttendanceRecords for duplicate (user_id, contest_id) pairs...');

  const dups = await db.query(`
    SELECT user_id, contest_id, COUNT(*) as cnt, MIN(id) as min_id, MAX(id) as max_id
    FROM AttendanceRecords
    GROUP BY user_id, contest_id
    HAVING cnt > 1
  `);

  console.log(`[Dedup] Found ${dups.length} duplicate groups.`);

  for (const d of dups) {
    // Delete all rows for (user_id, contest_id) except max_id
    console.log(`[Dedup] Cleaning user_id=${d.user_id}, contest_id=${d.contest_id} (keeping id=${d.max_id})...`);
    await db.query(
      "DELETE FROM AttendanceRecords WHERE user_id = ? AND contest_id = ? AND id < ?",
      [d.user_id, d.contest_id, d.max_id]
    );
  }

  console.log('[Dedup] Cleanup finished. Now adding missing columns...');

  const addCol = async (table, col, sqlDef) => {
    try {
      const cols = await db.query(`SHOW COLUMNS FROM ${table}`);
      const names = cols.map(c => c.Field.toLowerCase());
      if (!names.includes(col.toLowerCase())) {
        console.log(`[Dedup] Adding ${col} to ${table}...`);
        await db.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${sqlDef}`);
        console.log(`[Dedup] Added ${col} to ${table}.`);
      } else {
        console.log(`[Dedup] Column ${col} already exists in ${table}.`);
      }
    } catch (err) {
      console.warn(`[Dedup Warning] ${table}.${col}:`, err.message);
    }
  };

  await addCol('AttendanceRecords', 'sync_provider', "ENUM('GRAPHQL', 'CSV', 'LEGACY', 'HYBRID', 'MANUAL') DEFAULT 'GRAPHQL'");
  await addCol('AttendanceRecords', 'last_verified', "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
  await addCol('AttendanceRecords', 'verification_method', "VARCHAR(100) DEFAULT 'GRAPHQL_HISTORY'");
  await addCol('AttendanceRecords', 'sync_status', "VARCHAR(50) DEFAULT 'COMPLETED'");
  await addCol('AttendanceRecords', 'upstream_error', "TEXT DEFAULT NULL");

  console.log('[Dedup] All schema alterations completed successfully.');
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
