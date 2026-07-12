const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'leetcode_attendance'
  });

  console.log("Connected to database successfully.");

  try {
    const [platforms] = await connection.query("SELECT DISTINCT platform FROM Contests");
    console.log("Platforms in Contests table:", platforms);

    const [contests] = await connection.query("SELECT contest_id, title, platform, contest_status FROM Contests");
    console.log("All Contests in DB:", contests);
  } catch (err) {
    console.error("Error querying Contests:", err.message);
  }

  await connection.end();
}

run().catch(console.error);
