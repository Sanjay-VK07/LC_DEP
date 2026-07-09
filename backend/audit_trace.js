const db = require('./config/db');
const { normalizeUsername } = require('./utils/usernameNormalizer');

async function audit() {
  try {
    // Initialize database connection
    await db.initializeDatabase();

    // STEP 1: Users table row
    console.log('=== STEP 1: Users Table Row ===');
    const users = await db.query(
      "SELECT id, name, roll_no, leetcode_username, status, academic_start_date, academic_end_date FROM Users WHERE LOWER(leetcode_username) = LOWER('Ganeshkumar2006')",
      []
    );
    console.log('Users row count:', users.length);
    if (users.length > 0) {
      console.log('Users row:', JSON.stringify(users[0], null, 2));
    } else {
      // Try a broader search
      const broader = await db.query(
        "SELECT id, name, roll_no, leetcode_username, status FROM Users WHERE leetcode_username IS NOT NULL AND leetcode_username != '' LIMIT 10",
        []
      );
      console.log('No exact match. Sample users with LeetCode usernames:', JSON.stringify(broader, null, 2));
    }

    // STEP 2: Normalize username
    const rawUsername = users.length > 0 ? (users[0].leetcode_username || 'Ganeshkumar2006') : 'Ganeshkumar2006';
    const normalized = normalizeUsername(rawUsername);
    console.log('\n=== STEP 2: Username Normalization ===');
    console.log('Raw username from DB:', JSON.stringify(rawUsername));
    console.log('Normalized username:', JSON.stringify(normalized));
    console.log('Raw hex:', Buffer.from(rawUsername).toString('hex'));
    console.log('Normalized hex:', Buffer.from(normalized).toString('hex'));

    // STEP 3: Contest slug for Weekly Contest 507
    console.log('\n=== STEP 3: Contest Record ===');
    const contest = await db.query(
      "SELECT contest_id, title, slug, platform, start_time, source FROM Contests WHERE slug LIKE ? OR title LIKE ?",
      ['%507%', '%507%']
    );
    console.log('Contests matching 507:', JSON.stringify(contest, null, 2));

    // STEP 4: ContestParticipants for weekly-contest-507
    console.log('\n=== STEP 4: ContestParticipants COUNT for weekly-contest-507 ===');
    const cnt = await db.query(
      "SELECT COUNT(*) as cnt FROM ContestParticipants WHERE contest_slug = ?",
      ['weekly-contest-507']
    );
    console.log('Total rows in ContestParticipants for weekly-contest-507:', cnt[0].cnt);

    if (parseInt(cnt[0].cnt) > 0) {
      const sample = await db.query(
        "SELECT username, contest_slug, `rank`, score, problems_solved, finish_time FROM ContestParticipants WHERE contest_slug = ? ORDER BY `rank` LIMIT 5",
        ['weekly-contest-507']
      );
      console.log('Sample rows (top 5 by rank):', JSON.stringify(sample, null, 2));

      // Specific lookup for ganeshkumar2006
      const specific = await db.query(
        "SELECT username, contest_slug, `rank`, score, problems_solved, finish_time FROM ContestParticipants WHERE contest_slug = ? AND LOWER(TRIM(username)) = ?",
        ['weekly-contest-507', normalizeUsername('Ganeshkumar2006')]
      );
      console.log('\nSpecific lookup for "ganeshkumar2006":', JSON.stringify(specific, null, 2));
      if (specific.length === 0) {
        // Try fuzzy search
        const fuzzy = await db.query(
          "SELECT username, contest_slug, `rank`, score, problems_solved, finish_time FROM ContestParticipants WHERE contest_slug = ? AND LOWER(username) LIKE ?",
          ['weekly-contest-507', '%ganesh%']
        );
        console.log('Fuzzy search (LIKE %ganesh%):', JSON.stringify(fuzzy, null, 2));
      }
    }

    // STEP 5: LiveContests for weekly-contest-507
    console.log('\n=== STEP 5: LiveContests for weekly-contest-507 ===');
    const live = await db.query(
      "SELECT id, contestSlug, contestName, startTime, endTime, status FROM LiveContests WHERE contestSlug = ?",
      ['weekly-contest-507']
    );
    console.log('LiveContests:', JSON.stringify(live, null, 2));

    // STEP 6: Check if slug exists in ALL slugs in ContestParticipants
    console.log('\n=== STEP 6: All distinct contest slugs in ContestParticipants ===');
    const slugs = await db.query(
      "SELECT DISTINCT contest_slug FROM ContestParticipants ORDER BY contest_slug DESC LIMIT 20",
      []
    );
    console.log('All distinct slugs:', JSON.stringify(slugs.map(s => s.contest_slug), null, 2));

    process.exit(0);
  } catch (err) {
    console.error('AUDIT ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}
audit();
