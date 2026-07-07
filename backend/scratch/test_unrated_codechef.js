const db = require('../config/db');
const { normalizeCodeChefProfile } = require('../services/normalizationService');
const { getUnifiedStudentProfile } = require('../services/platformAnalyticsService');

async function testUnratedAndInactive() {
  await db.initializeDatabase();

  const userId = 10009; // Let's use Saran for testing
  
  console.log('=== TEST 1: UNRATED PROFILE FLOW ===');
  // Mock a scraper output for an unrated user (successfully verified, but no rating or history)
  const unratedScraped = {
    success: true,
    username: 'saran_0909',
    rating: null,
    maxRating: null,
    lowestRating: null,
    stars: null,
    globalRanking: null,
    countryRank: null,
    problemsSolved: 0,
    contestParticipationCount: 0,
    contestHistory: [],
    ratingHistory: []
  };

  console.log('1. Normalizing unrated profile...');
  const normalized = normalizeCodeChefProfile(unratedScraped, 'saran_0909');
  console.log('Normalized output:', normalized);

  console.log('\n2. Saving unrated profile to database...');
  await db.query(`
    INSERT INTO CodeChefProfiles (user_id, current_rating, highest_rating, lowest_rating, is_provisional, status, global_ranking, country_rank, problems_solved, stars, contest_history, rating_history, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      current_rating = VALUES(current_rating),
      highest_rating = VALUES(highest_rating),
      lowest_rating = VALUES(lowest_rating),
      is_provisional = VALUES(is_provisional),
      status = VALUES(status),
      global_ranking = VALUES(global_ranking),
      country_rank = VALUES(country_rank),
      problems_solved = VALUES(problems_solved),
      stars = VALUES(stars),
      contest_history = VALUES(contest_history),
      rating_history = VALUES(rating_history),
      last_synced = NOW()
  `, [
    userId,
    normalized.rating,
    normalized.maxRating,
    normalized.lowestRating,
    normalized.isProvisional ? 1 : 0,
    normalized.status || 'UNRATED',
    normalized.rank,
    normalized.countryRank,
    normalized.problemsSolved,
    normalized.stars,
    JSON.stringify(normalized.metadata.contestHistory),
    JSON.stringify(normalized.metadata.ratingHistory)
  ]);

  console.log('\n3. Reading unrated profile via Analytics Service...');
  const profileResult = await getUnifiedStudentProfile(userId);
  console.log('Unified Profile for Unrated User:', profileResult.profiles.codechef);

  console.log('\n=== TEST 2: INACTIVE/UNAVAILABLE PROFILE FLOW ===');
  // Mock an inactive profile (e.g. scrape failed completely or username invalid)
  const inactiveScraped = {
    success: false,
    verified: false,
    message: 'Profile not found or inactive'
  };

  console.log('1. Normalizing inactive profile...');
  const normalizedInactive = normalizeCodeChefProfile(inactiveScraped, 'saran_0909');
  console.log('Normalized inactive output:', normalizedInactive);

  process.exit(0);
}

testUnratedAndInactive().catch(err => {
  console.error(err);
  process.exit(1);
});
