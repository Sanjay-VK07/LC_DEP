const db = require('../config/db');

async function run() {
  await db.initializeDatabase();

  const users = await db.query(`
    SELECT id, name, roll_no, codechef_username FROM Users WHERE status = 'active'
  `);
  console.log('=== USERS ===');
  console.log(users);

  const ccProfiles = await db.query(`
    SELECT * FROM CodeChefProfiles
  `);
  console.log('=== CODECHEF PROFILES ===');
  ccProfiles.forEach(p => {
    console.log({
      id: p.id,
      user_id: p.user_id,
      current_rating: p.current_rating,
      highest_rating: p.highest_rating,
      global_ranking: p.global_ranking,
      problems_solved: p.problems_solved,
      stars: p.stars,
      country_rank: p.country_rank,
      last_synced: p.last_synced,
      contest_history_length: p.contest_history ? JSON.parse(p.contest_history).length : 0
    });
  });

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
