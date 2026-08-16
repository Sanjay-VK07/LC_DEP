const { initializeDatabase, query } = require('../backend/config/db');
const bcrypt = require('../backend/node_modules/bcryptjs');

async function testPasswords() {
  try {
    await initializeDatabase();
    const rows = await query("SELECT id, username, password_hash FROM Accounts");
    const passwordsToTry = ['admin123', 'admin', 'cse123', 'cseadmin', 'password', '123456'];
    
    for (const acc of rows) {
      console.log(`Checking account: ${acc.username}`);
      for (const pass of passwordsToTry) {
        const match = await bcrypt.compare(pass, acc.password_hash);
        if (match) {
          console.log(`  ✓ FOUND PASSWORD for ${acc.username}: ${pass}`);
        }
      }
    }
  } catch (err) {
    console.error("Error testing passwords:", err.message);
  } finally {
    process.exit(0);
  }
}

testPasswords();
