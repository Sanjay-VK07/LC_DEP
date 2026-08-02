const db = require('./config/db');
const leetcodeUtils = require('./utils/leetcode');

function slugifyTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

async function testUsers() {
  await db.initializeDatabase();
  const students = await db.query("SELECT id, leetcode_username FROM Users WHERE status = 'active' AND leetcode_username IS NOT NULL AND leetcode_username != '' LIMIT 5");

  console.log(`Found ${students.length} active students.`);

  for (const s of students) {
    const handle = s.leetcode_username;
    console.log(`\n----------------------------------------`);
    console.log(`Testing user: "${handle}" (ID: ${s.id})`);

    try {
      const data = await leetcodeUtils.getUserContestRankingAndHistory(handle);
      const history = data?.userContestRankingHistory || [];
      console.log(`History length for ${handle}: ${history.length}`);

      if (history.length > 0) {
        console.log('Sample entry from history:', JSON.stringify(history[history.length - 1], null, 2));

        const targetSlug = 'weekly-contest-513';
        const match = history.find(h => {
          const titleSlug = slugifyTitle(h?.contest?.title || '');
          return titleSlug === targetSlug;
        });

        console.log(`Matching target "${targetSlug}":`, match ? `FOUND (Attended: ${match.attended}, Solved: ${match.problemsSolved})` : 'NOT FOUND');
      }
    } catch (err) {
      console.error(`Error for ${handle}:`, err.message);
    }
  }

  process.exit(0);
}

testUsers();
