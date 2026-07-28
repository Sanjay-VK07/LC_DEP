const db = require('../../config/db');

async function run() {
  await db.initializeDatabase();
  console.log('[FixCols] Checking AttendanceRecords columns...');

  const add = async (col, typeDef) => {
    try {
      const cols = await db.query("SHOW COLUMNS FROM AttendanceRecords");
      const names = cols.map(c => c.Field.toLowerCase());
      if (!names.includes(col.toLowerCase())) {
        console.log(`[FixCols] Adding ${col}...`);
        await db.query(`ALTER TABLE AttendanceRecords ADD COLUMN ${col} ${typeDef}`);
        console.log(`[FixCols] Added ${col}.`);
      } else {
        console.log(`[FixCols] ${col} already exists.`);
      }
    } catch (err) {
      console.error(`[FixCols Error] ${col}:`, err.message);
    }
  };

  await add('sync_status', "VARCHAR(50) DEFAULT 'COMPLETED'");
  await add('last_verified', "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
  await add('upstream_error', "TEXT DEFAULT NULL");

  console.log('[FixCols] Done.');
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
