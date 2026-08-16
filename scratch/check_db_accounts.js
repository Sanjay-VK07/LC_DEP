const { initializeDatabase, query } = require('../backend/config/db');

async function checkAccounts() {
  try {
    await initializeDatabase();
    const accounts = await query("SELECT id, username, role, name, email FROM Accounts");
    console.log("Accounts in database:", accounts);
  } catch (err) {
    console.error("Error querying Accounts:", err.message);
  } finally {
    process.exit(0);
  }
}

checkAccounts();
