const db = require('./config/db');
const { getLeetCodeOfficialStartTime } = require('./utils/contestLifecycle');

async function main() {
  await db.initializeDatabase();

  const rows = await db.query(
    "SELECT contest_id, slug, title, start_time FROM Contests WHERE slug LIKE '%weekly-contest%' OR slug LIKE '%biweekly-contest%' ORDER BY contest_id DESC LIMIT 10"
  );

  console.log('=== Database Verification: Official LeetCode Contest Dates ===');
  for (const r of rows) {
    const officialDate = getLeetCodeOfficialStartTime(r.slug);
    console.log(`Contest: ${r.slug} | DB Stored: ${r.start_time} | Computed Official UTC: ${officialDate ? officialDate.toISOString() : 'N/A'}`);
  }

  process.exit(0);
}

main();
