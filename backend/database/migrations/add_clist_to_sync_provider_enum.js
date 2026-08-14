const db = require('../../config/db');

async function up() {
  console.log('[Migration] Starting add_clist_to_sync_provider_enum migration...');
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

    // Helper to safely update ENUM definition if 'CLIST' is not present
    const addEnumOptionIfMissing = async (table, column, newEnumDefinition) => {
      const cols = await db.query(`SHOW COLUMNS FROM ${table}`);
      const targetCol = cols.find(c => c.Field.toLowerCase() === column.toLowerCase());
      if (targetCol) {
        const typeStr = (targetCol.Type || '').toUpperCase();
        if (!typeStr.includes("'CLIST'")) {
          console.log(`[Migration] Modifying column ${column} on table ${table} to include 'CLIST'...`);
          await db.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} ${newEnumDefinition}`);
          console.log(`[Migration] Column ${column} on table ${table} updated successfully.`);
        } else {
          console.log(`[Migration] Column ${column} on table ${table} already includes 'CLIST'. Skipping.`);
        }
      }
    };

    // Modify ContestAttendance.syncProvider
    await addEnumOptionIfMissing(
      'ContestAttendance',
      'syncProvider',
      "ENUM('GRAPHQL', 'CSV', 'LEGACY', 'HYBRID', 'MANUAL', 'CLIST') DEFAULT 'GRAPHQL'"
    );

    // Modify AttendanceRecords.sync_provider
    await addEnumOptionIfMissing(
      'AttendanceRecords',
      'sync_provider',
      "ENUM('GRAPHQL', 'CSV', 'LEGACY', 'HYBRID', 'MANUAL', 'CLIST') DEFAULT 'GRAPHQL'"
    );

    // Record migration execution
    await db.query(`
      INSERT INTO Schema_Migrations (migration_name) 
      VALUES ('add_clist_to_sync_provider_enum')
      ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
    `);

    console.log('[Migration] Migration "add_clist_to_sync_provider_enum" completed successfully.');
  } catch (err) {
    console.error('[Migration Error] Failed executing add_clist_to_sync_provider_enum migration:', err.message);
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
