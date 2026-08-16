const { query } = require('../backend/config/db');

async function checkUsers() {
  try {
    const users = await query("SELECT id, username, email, role, created_at FROM Users LIMIT 20");
    console.log("Users in database:", users);
  } catch (err) {
    console.error("Error querying Users:", err.message);
  } finally {
    process.exit(0);
  }
}

checkUsers();
