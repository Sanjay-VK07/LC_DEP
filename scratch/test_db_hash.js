const { initializeDatabase, query } = require('../backend/config/db');
const bcrypt = require('../backend/node_modules/bcryptjs');

async function checkHashes() {
  try {
    await initializeDatabase();
    const rows = await query("SELECT id, username, password_hash FROM Accounts");
    console.log("Accounts found:", rows.length);
    
    const testWords = ['cse1234', 'cseadmin', 'admin', 'admin123', 'cse', 'password', '123456', 'DEC@2024', 'enthra123', 'college123'];

    for (const acc of rows) {
      console.log(`\nAccount [${acc.username}] hash: ${acc.password_hash}`);
      for (const w of testWords) {
        const match = await bcrypt.compare(w, acc.password_hash);
        if (match) {
          console.log(`>>> MATCH FOUND FOR ${acc.username}: ${w} <<<`);
        }
      }
    }
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    process.exit(0);
  }
}

checkHashes();
