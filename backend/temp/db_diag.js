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
    const [users] = await connection.query("SELECT * FROM Users");
    console.log("Users:", users);
  } catch (err) {
    console.error("Error fetching users:", err.message);
  }

  try {
    const [records] = await connection.query("SELECT * FROM AttendanceRecords LIMIT 10");
    console.log("Sample AttendanceRecords:", records);
  } catch (err) {
    console.error("Error fetching AttendanceRecords:", err.message);
  }

  await connection.end();
}

run().catch(console.error);
