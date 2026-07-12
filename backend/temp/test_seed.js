const { seedMasterContests } = require('../utils/scheduler');
const db = require('../config/db');

async function test() {
  await db.initializeDatabase();
  console.log("Starting seedMasterContests...");
  try {
    const res = await seedMasterContests();
    console.log("Seeding result:", res);
  } catch (err) {
    console.error("Seeding error:", err);
  }
  process.exit(0);
}

test();
