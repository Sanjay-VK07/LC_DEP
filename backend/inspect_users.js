const db = require('./config/db');

async function main() {
  try {
    await db.initializeDatabase();
    const columns = await db.query("SHOW COLUMNS FROM Users");
    console.log("Users Table Columns:");
    console.log(columns.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null })));
    process.exit(0);
  } catch (err) {
    console.error("Error inspecting Users:", err);
    process.exit(1);
  }
}

main();
