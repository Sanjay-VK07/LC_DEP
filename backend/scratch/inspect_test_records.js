const db = require('../config/db');

async function run() {
  await db.initializeDatabase();

  const query = `
    SELECT id, contestSlug, contestName, platform 
    FROM LiveContests 
    WHERE contestSlug LIKE '%test-%'
       OR contestSlug LIKE '%demo-%'
       OR contestSlug LIKE '%crashed-%'
       OR contestSlug LIKE '%retry-%'
       OR contestSlug LIKE '%upcoming-%'
       OR contestSlug LIKE '%stale-%'
       OR contestSlug LIKE '%fail-%'
       OR contestName LIKE '%test%'
       OR contestName LIKE '%demo%'
       OR contestName LIKE '%fail%'
  `;
  const records = await db.query(query);
  console.log(`Found ${records.length} test/demo contests in LiveContests.`);
  
  // Print first 10 for validation
  console.log('First 10 records:', records.slice(0, 10));

  // Let's do the same for Contests table
  const query2 = `
    SELECT contest_id, title, slug, platform 
    FROM Contests 
    WHERE slug LIKE '%test-%'
       OR slug LIKE '%demo-%'
       OR slug LIKE '%crashed-%'
       OR slug LIKE '%retry-%'
       OR slug LIKE '%upcoming-%'
       OR slug LIKE '%stale-%'
       OR slug LIKE '%fail-%'
       OR title LIKE '%test%'
       OR title LIKE '%demo%'
       OR title LIKE '%fail%'
  `;
  const records2 = await db.query(query2);
  console.log(`Found ${records2.length} test/demo contests in Contests.`);
  console.log('First 10 records in Contests:', records2.slice(0, 10));

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
