const { initializeDatabase, query } = require('../backend/config/db');

async function describeUsers() {
  try {
    await initializeDatabase();
    const cols = await query("DESCRIBE Users");
    console.log("Columns in Users table:", cols.map(c => c.Field));
  } catch (err) {
    console.error("Error DESCRIBE Users:", err.message);
  } finally {
    process.exit(0);
  }
}

describeUsers();
