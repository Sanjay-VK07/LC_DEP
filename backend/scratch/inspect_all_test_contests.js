const db = require('../config/db');

async function run() {
  await db.initializeDatabase();

  console.log('=== FINDING DUPLICATES BY TITLE OR SLUG OR NUMBER ===');
  // Duplicate contest titles in Contests
  const cDupTitles = await db.query(`
    SELECT title, platform, COUNT(*) as count 
    FROM Contests 
    GROUP BY title, platform 
    HAVING count > 1
  `);
  console.log('Duplicate titles in Contests:', cDupTitles);

  // Duplicate titles in LiveContests
  const lcDupTitles = await db.query(`
    SELECT contestName, platform, COUNT(*) as count 
    FROM LiveContests 
    GROUP BY contestName, platform 
    HAVING count > 1
  `);
  console.log('Duplicate titles in LiveContests:', lcDupTitles);

  // Check for duplicate slugs
  const cDupSlugs = await db.query('SELECT slug, COUNT(*) as count FROM Contests GROUP BY slug HAVING count > 1');
  const lcDupSlugs = await db.query('SELECT contestSlug, COUNT(*) as count FROM LiveContests GROUP BY contestSlug HAVING count > 1');
  console.log('Duplicate slugs in Contests:', cDupSlugs);
  console.log('Duplicate slugs in LiveContests:', lcDupSlugs);

  console.log('\n=== LISTING ALL TEST CONTESTS IN CONTESTS ===');
  const testC = await db.query(`
    SELECT contest_id, title, slug, platform 
    FROM Contests 
    WHERE slug LIKE '%test%' OR slug LIKE '%demo%' OR title LIKE '%test%' OR title LIKE '%demo%'
  `);
  console.log(testC);

  console.log('\n=== LISTING ALL TEST CONTESTS IN LIVE CONTESTS ===');
  const testLC = await db.query(`
    SELECT id, contestSlug, contestName, platform 
    FROM LiveContests 
    WHERE contestSlug LIKE '%test%' OR contestSlug LIKE '%demo%' OR contestName LIKE '%test%' OR contestName LIKE '%demo%'
  `);
  console.log(testLC);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
