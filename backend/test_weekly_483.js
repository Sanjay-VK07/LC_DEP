require('dotenv').config();
const db = require('./config/db');
const https = require('https');

let sessionCookie = null;

function fetchSessionCookie() {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'leetcode.com',
      path: '/graphql/',
      method: 'GET',
      headers: {
        'User-Agent': process.env.LEETCODE_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      },
      timeout: 10000
    }, (res) => {
      res.resume();
      const setCookie = res.headers['set-cookie'] || [];
      const csrfLine = setCookie.find(c => c.startsWith('csrftoken'));
      if (csrfLine) {
        sessionCookie = csrfLine.split(';')[0];
      }
      resolve(sessionCookie);
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function makeGraphQLRequest(query, variables = {}) {
  if (!sessionCookie) {
    await fetchSessionCookie();
  }

  const postData = JSON.stringify({ query, variables });
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'User-Agent': process.env.LEETCODE_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Referer': 'https://leetcode.com/'
    };

    if (sessionCookie) {
      headers['Cookie'] = sessionCookie;
      const csrfToken = sessionCookie.split('=')[1];
      if (csrfToken) {
        headers['x-csrftoken'] = csrfToken;
      }
    }

    const req = https.request({
      hostname: 'leetcode.com',
      path: '/graphql/',
      method: 'POST',
      headers,
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse error (HTTP ${res.statusCode}). Raw response snippet: ${data.substring(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// First query with standard userContestRankingHistory fields
const USER_CONTEST_HISTORY_QUERY = `
query userContestRankingHistory($username: String!) {
  userContestRankingHistory(username: $username) {
    attended
    trendDirection
    problemsSolved
    totalProblems
    finishTimeInSeconds
    rating
    ranking
    contest {
      title
      titleSlug
      startTime
    }
  }
}
`;

const CONTEST_DETAIL_QUERY = `
query getContestDetail($contestSlug: String!) {
  contestDetail(contestSlug: $contestSlug) {
    titleSlug
    startTime
    duration
  }
}
`;

function slugify(title) {
  if (!title) return '';
  return title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

async function run() {
  console.log('=== LEETCODE GRAPHQL STANDALONE TEST FOR WEEKLY-CONTEST-483 ===\n');

  // Fetch CSRF Cookie first
  await fetchSessionCookie();

  // Step 1: Pick active students from database
  await db.initializeDatabase();
  const students = await db.query(
    "SELECT id, leetcode_username FROM Users WHERE status = 'active' AND leetcode_username IS NOT NULL AND leetcode_username != '' LIMIT 10"
  );

  if (!students || students.length === 0) {
    console.error('No active students found in database.');
    process.exit(1);
  }

  console.log(`Fetched active student handles from database:`);
  students.forEach((s, idx) => console.log(`  ${idx + 1}. ${s.leetcode_username}`));
  console.log('');

  const targetSlug = 'weekly-contest-483';
  let foundInUserHistory = false;
  let usersTried = 0;
  const maxUsersToTry = 4; // Try 1 handle first, up to 3-4 handles total if not found

  for (const student of students) {
    if (usersTried >= maxUsersToTry && foundInUserHistory) break;

    const username = student.leetcode_username;
    usersTried++;
    console.log(`==================================================`);
    console.log(`Querying userContestRankingHistory for handle #${usersTried}: "${username}"`);
    console.log(`==================================================`);

    try {
      const response = await makeGraphQLRequest(USER_CONTEST_HISTORY_QUERY, { username });

      if (response.errors) {
        console.log(`GraphQL errors for ${username}:`, JSON.stringify(response.errors, null, 2));
        continue;
      }

      const history = response?.data?.userContestRankingHistory || [];
      console.log(`Total history entries returned for ${username}: ${history.length}`);

      // Search history for weekly-contest-483
      const match = history.find(entry => {
        const slugFromTitle = slugify(entry?.contest?.title || '');
        const slugFromField = entry?.contest?.titleSlug || '';
        return slugFromTitle === targetSlug || slugFromField === targetSlug;
      });

      if (match) {
        foundInUserHistory = true;
        console.log(`\n>>> MATCH FOUND FOR "${targetSlug}" IN HISTORY OF USER: "${username}" <<<`);
        console.log('FULL RAW JSON FOR SPECIFIC CONTEST ENTRY:');
        console.log(JSON.stringify(match, null, 2));
        console.log('');
      } else {
        console.log(`No entry matching "${targetSlug}" found in history of "${username}".`);
        if (history.length > 0) {
          console.log(`Most recent contest in history for "${username}":`, JSON.stringify(history[history.length - 1], null, 2));
        }
        console.log('');
      }
    } catch (err) {
      console.error(`Error querying user ${username}:`, err.message);
    }
  }

  if (!foundInUserHistory) {
    console.log(`\nSummary: Tried ${usersTried} student handles. Contest "${targetSlug}" was NOT found in any of their userContestRankingHistory.\n`);
  }

  // Step 6: Separately query getContestDetail for weekly-contest-483
  console.log(`==================================================`);
  console.log(`Querying getContestDetail for contestSlug: "${targetSlug}"`);
  console.log(`==================================================`);
  try {
    const contestDetailResponse = await makeGraphQLRequest(CONTEST_DETAIL_QUERY, { contestSlug: targetSlug });
    console.log('FULL RAW RESPONSE FOR getContestDetail:');
    console.log(JSON.stringify(contestDetailResponse, null, 2));
  } catch (err) {
    console.error('Error querying getContestDetail:', err.message);
  }

  console.log('\n=== TEST COMPLETE ===');
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
