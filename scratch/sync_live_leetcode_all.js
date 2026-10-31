const axios = require('../backend/node_modules/axios');
const db = require('../backend/config/db');

const QUERY = `
  query userStats($username: String!) {
    matchedUser(username: $username) {
      submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
        }
      }
    }
    userContestRanking(username: $username) {
      rating
      globalRanking
      attendedContestsCount
    }
  }
`;

async function fetchLeetCodeUser(username) {
  try {
    const res = await axios.post('https://leetcode.com/graphql', {
      query: QUERY,
      variables: { username }
    }, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'referer': `https://leetcode.com/${username}/`
      },
      timeout: 8000
    });

    const matchedUser = res.data?.data?.matchedUser;
    if (!matchedUser) {
      return null;
    }

    const acSubmissions = matchedUser.submitStatsGlobal?.acSubmissionNum || [];
    let easy = 0, medium = 0, hard = 0, total = 0;

    for (const item of acSubmissions) {
      if (item.difficulty === 'All') total = item.count;
      else if (item.difficulty === 'Easy') easy = item.count;
      else if (item.difficulty === 'Medium') medium = item.count;
      else if (item.difficulty === 'Hard') hard = item.count;
    }

    const contestRanking = res.data?.data?.userContestRanking;
    const rating = contestRanking?.rating ? Math.round(contestRanking.rating * 100) / 100 : null;
    const attended = contestRanking?.attendedContestsCount || 0;

    return {
      easy,
      medium,
      hard,
      total,
      rating,
      attended
    };
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log("======================================================================");
  console.log("          FETCHING FRESH LIVE DATA FROM LEETCODE API                  ");
  console.log("======================================================================\n");

  await db.initializeDatabase();
  const pool = db.getPool();
  const connection = await pool.getConnection();

  const [users] = await connection.query(`
    SELECT id, roll_no, name, leetcode_username 
    FROM Users 
    WHERE status = 'active' AND leetcode_username IS NOT NULL AND leetcode_username != ''
    ORDER BY id ASC
  `);

  console.log(`Found ${users.length} active students with LeetCode usernames.\n`);

  const BATCH_SIZE = 15;
  let successCount = 0;
  let failedCount = 0;
  let updatedCount = 0;

  const t0 = Date.now();

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const chunk = users.slice(i, i + BATCH_SIZE);
    
    await Promise.all(chunk.map(async (u) => {
      const stats = await fetchLeetCodeUser(u.leetcode_username);
      if (stats) {
        successCount++;
        // Check if rating or solved changed
        const ratingVal = stats.rating || 1500;
        await connection.query(`
          INSERT INTO LeetCodeProfiles (user_id, easy_solved, medium_solved, hard_solved, problems_solved, current_rating, highest_rating, last_synced)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            easy_solved = VALUES(easy_solved),
            medium_solved = VALUES(medium_solved),
            hard_solved = VALUES(hard_solved),
            problems_solved = VALUES(problems_solved),
            current_rating = VALUES(current_rating),
            highest_rating = GREATEST(COALESCE(highest_rating, 0), VALUES(current_rating)),
            last_synced = NOW()
        `, [u.id, stats.easy, stats.medium, stats.hard, stats.total, ratingVal, ratingVal]);
        updatedCount++;
      } else {
        failedCount++;
      }
    }));

    if ((i + BATCH_SIZE) % 150 === 0 || i + BATCH_SIZE >= users.length) {
      const processed = Math.min(i + BATCH_SIZE, users.length);
      console.log(`[Progress] Processed ${processed} / ${users.length} students (${successCount} successful, ${failedCount} errors) - elapsed: ${Math.round((Date.now() - t0)/1000)}s`);
    }

    // Small delay between batches to respect rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n✓ Live LeetCode Sync Completed in ${Math.round((Date.now() - t0)/1000)}s!`);
  console.log(`   - Successfully fetched: ${successCount}`);
  console.log(`   - Unchanged / Failed:   ${failedCount}`);

  // Invalidate Cache
  const cache = require('../backend/services/analyticsCacheService');
  cache.invalidateAll();

  connection.release();
  await pool.end();
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
