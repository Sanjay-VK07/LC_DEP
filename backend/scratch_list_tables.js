const db = require('./config/db');

async function main() {
  try {
    await db.initializeDatabase();
    const tables = await db.query("SHOW TABLES");
    console.log("Database Tables:");
    console.log(tables.map(t => Object.values(t)[0]));
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
