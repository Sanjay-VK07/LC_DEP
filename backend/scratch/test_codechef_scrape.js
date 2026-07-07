const { getUserCodeChefStats } = require('../utils/codechef');
const db = require('../config/db');

async function run() {
  await db.initializeDatabase();
  console.log('Fetching stats for divyaroopag...');
  const stats = await getUserCodeChefStats('divyaroopag');
  console.log('Scraped stats result:', JSON.stringify(stats, null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
