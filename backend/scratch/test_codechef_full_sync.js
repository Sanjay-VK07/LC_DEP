const db = require('../config/db');
const { syncStudentPlatform } = require('../utils/scheduler');
const { getUnifiedStudentProfile } = require('../services/platformAnalyticsService');

async function run() {
  await db.initializeDatabase();

  const userId = process.argv[2] ? parseInt(process.argv[2], 10) : 10011;
  console.log(`Running test sync for User ID: ${userId}`);

  console.log('=== STEP 1: BEFORE SYNC DB STATE ===');
  const [beforeCc] = await db.query('SELECT * FROM CodeChefProfiles WHERE user_id = ?', [userId]);
  console.log('DB Row before sync:', beforeCc);

  console.log('\n=== STEP 2: TRIGGERING PLATFORM SYNC ===');
  const syncResult = await syncStudentPlatform(userId, 'codechef', true);
  console.log('Sync result:', syncResult);

  console.log('\n=== STEP 3: AFTER SYNC DB STATE ===');
  const [afterCc] = await db.query('SELECT * FROM CodeChefProfiles WHERE user_id = ?', [userId]);
  if (afterCc) {
    console.log('DB Row after sync:', {
      id: afterCc.id,
      user_id: afterCc.user_id,
      current_rating: afterCc.current_rating,
      highest_rating: afterCc.highest_rating,
      lowest_rating: afterCc.lowest_rating,
      global_ranking: afterCc.global_ranking,
      problems_solved: afterCc.problems_solved,
      stars: afterCc.stars,
      country_rank: afterCc.country_rank,
      last_synced: afterCc.last_synced,
      rating_history: afterCc.rating_history
    });
  } else {
    console.log('No DB Row found after sync.');
  }

  console.log('\n=== STEP 4: FETCHING UNIFIED STUDENT PROFILE ===');
  const unified = await getUnifiedStudentProfile(userId);
  if (unified) {
    console.log('Unified Profile CodeChef:', unified.profiles.codechef);
  } else {
    console.log('No Unified Profile found.');
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
