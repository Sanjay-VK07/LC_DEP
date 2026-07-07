const db = require('../config/db');

async function run() {
  await db.initializeDatabase();

  console.log('=== COUNT OF ALL CONTESTS ===');
  const countContests = await db.query('SELECT COUNT(*) as count FROM Contests');
  const countLiveContests = await db.query('SELECT COUNT(*) as count FROM LiveContests');
  console.log('Contests count:', countContests[0].count);
  console.log('LiveContests count:', countLiveContests[0].count);

  console.log('\n=== LIST OF ALL CONTESTS ===');
  const contests = await db.query('SELECT * FROM Contests');
  console.log(contests);

  console.log('\n=== LIST OF ALL LIVE CONTESTS ===');
  const liveContests = await db.query('SELECT * FROM LiveContests');
  console.log(liveContests);

  console.log('\n=== DUPLICATES IN CONTESTS BY SLUG ===');
  const ccDupSlugs = await db.query(`
    SELECT slug, COUNT(*) as count 
    FROM Contests 
    GROUP BY slug 
    HAVING COUNT(*) > 1
  `);
  console.log(ccDupSlugs);

  console.log('\n=== DUPLICATES IN LIVE CONTESTS BY SLUG ===');
  const lcDupSlugs = await db.query(`
    SELECT contestSlug, COUNT(*) as count 
    FROM LiveContests 
    GROUP BY contestSlug 
    HAVING COUNT(*) > 1
  `);
  console.log(lcDupSlugs);

  console.log('\n=== TEST CONTESTS IN CONTESTS ===');
  const testContests = await db.query(`
    SELECT * FROM Contests 
    WHERE slug LIKE '%test%' OR slug LIKE '%demo%' OR title LIKE '%test%' OR title LIKE '%demo%'
  `);
  console.log(testContests);

  console.log('\n=== TEST CONTESTS IN LIVE CONTESTS ===');
  const testLiveContests = await db.query(`
    SELECT * FROM LiveContests 
    WHERE contestSlug LIKE '%test%' OR contestSlug LIKE '%demo%' OR contestName LIKE '%test%' OR contestName LIKE '%demo%'
  `);
  console.log(testLiveContests);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
