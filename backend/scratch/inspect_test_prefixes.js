const db = require('../config/db');

async function run() {
  await db.initializeDatabase();

  const query = `
    SELECT id, contestSlug, contestName, platform 
    FROM LiveContests 
    WHERE contestSlug LIKE 'test-%'
       OR contestSlug LIKE 'crashed-%'
       OR contestSlug LIKE 'retry-%'
       OR contestSlug LIKE 'upcoming-%'
       OR contestSlug LIKE 'stale-%'
       OR contestSlug LIKE 'fail-%'
       OR contestSlug LIKE 'demo-%'
  `;
  const records = await db.query(query);
  console.log(`Found ${records.length} test/demo contests in LiveContests using prefix query.`);
  console.log('First 5:', records.slice(0, 5));
  console.log('Last 5:', records.slice(-5));

  const query2 = `
    SELECT contest_id, title, slug, platform 
    FROM Contests 
    WHERE slug LIKE 'test-%'
       OR slug LIKE 'crashed-%'
       OR slug LIKE 'retry-%'
       OR slug LIKE 'upcoming-%'
       OR slug LIKE 'stale-%'
       OR slug LIKE 'fail-%'
       OR slug LIKE 'demo-%'
  `;
  const records2 = await db.query(query2);
  console.log(`\nFound ${records2.length} test/demo contests in Contests using prefix query.`);
  console.log('First 5 in Contests:', records2.slice(0, 5));
  console.log('Last 5 in Contests:', records2.slice(-5));

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
