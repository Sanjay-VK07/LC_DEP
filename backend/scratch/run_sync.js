const db = require('../config/db');
const LeetCodeProvider = require('../services/connectors/LeetCodeProvider');
const studentSyncQueue = require('../services/studentSyncQueue');
const snapshotEngine = require('../services/snapshotEngine');

async function run() {
  await db.initializeDatabase();

  // Find specific contest
  const latestRows = await db.query("SELECT id, contestSlug, platform FROM LiveContests WHERE contestSlug = 'weekly-contest-509'");
  if (latestRows.length === 0) {
    console.error('No live contests found');
    process.exit(1);
  }
  const contest = latestRows[0];
  console.log('Target contest:', contest);

  // Initialize provider
  const provider = new LeetCodeProvider();
  
  // Let's force download/rebuild cache for the contest
  console.log(`Refreshing cache for: ${contest.contestSlug}`);
  await provider.refreshLeaderboardCache(contest.contestSlug);

  // Let's print a few keys from the index
  const index = provider.leaderboardIndices[contest.contestSlug];
  console.log(`Indexed participants count: ${Object.keys(index || {}).length}`);
  console.log('Sample indexed keys:', Object.keys(index || {}).slice(0, 10));

  // Let's fetch the students
  const students = await db.query("SELECT id, name, leetcode_username FROM Users WHERE status = 'active'");
  console.log('Students:', students);

  // Let's see if any match the index!
  for (const student of students) {
    const username = student.leetcode_username;
    if (!username) {
      console.log(`Student ${student.name} has no leetcode_username`);
      continue;
    }
    const cleanUsername = username.trim().toLowerCase();
    const stats = index[cleanUsername];
    if (stats) {
      console.log(`MATCH! Student ${student.name} (${username}) matches index. Rank: ${stats.rank}`);
    } else {
      console.log(`MISMATCH! Student ${student.name} (${username}) [clean: "${cleanUsername}"] not found in index.`);
    }
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
