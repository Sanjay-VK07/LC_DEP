const db = require('../config/db');

async function run() {
  await db.initializeDatabase();

  const query = `
    SELECT id, contestSlug, contestName, platform 
    FROM LiveContests 
    WHERE contestSlug NOT LIKE 'weekly-contest-%'
      AND contestSlug NOT LIKE 'biweekly-contest-%'
      AND contestSlug NOT LIKE 'starters-%'
      AND contestSlug NOT LIKE 'round-%'
      AND contestSlug NOT LIKE 'div-%'
      AND contestSlug NOT LIKE 'cook-%'
      AND contestSlug NOT LIKE 'lunchtime-%'
  `;
  const records = await db.query(query);
  console.log(`Found ${records.length} non-standard contests in LiveContests.`);
  console.log('List:', records);

  const query2 = `
    SELECT contest_id, title, slug, platform 
    FROM Contests 
    WHERE slug NOT LIKE 'weekly-contest-%'
      AND slug NOT LIKE 'biweekly-contest-%'
      AND slug NOT LIKE 'starters-%'
      AND slug NOT LIKE 'round-%'
      AND slug NOT LIKE 'div-%'
      AND slug NOT LIKE 'cook-%'
      AND slug NOT LIKE 'lunchtime-%'
  `;
  const records2 = await db.query(query2);
  console.log(`\nFound ${records2.length} non-standard contests in Contests.`);
  console.log('List:', records2);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
