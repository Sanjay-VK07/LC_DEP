const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const { syncStudentPlatform } = require('../utils/scheduler');
const { getUnifiedStudentProfile } = require('../services/platformAnalyticsService');
const LeetCodeConnector = require('../services/connectors/LeetCodeConnector');

let testUserId = null;
let originalFetchProfile = null;

before(async () => {
  await db.initializeDatabase();
  originalFetchProfile = LeetCodeConnector.fetchProfile;

  // Clean up any old test users
  await db.query("DELETE FROM Users WHERE roll_no = 'SYNC-TEST-REG-001'");
  
  // Insert a test user
  const insertRes = await db.query(
    `INSERT INTO Users (name, roll_no, department, section, leetcode_username, status, academic_batch, academic_start_date, academic_end_date)
     VALUES ('Sync Test Student', 'SYNC-TEST-REG-001', 'CSE', 'A', 'sync_test_lc', 'active', '2024-2028', '2024-06-01', '2028-06-01')`
  );
  testUserId = insertRes.insertId || (insertRes[0] ? insertRes[0].insertId : null);
});

test('Sync Pipeline Case 1: Successful LeetCode sync populates LeetCodeProfiles', async () => {
  // Clear any existing profiles or sync states
  await db.query("DELETE FROM LeetCodeProfiles WHERE user_id = ?", [testUserId]);
  await db.query("DELETE FROM StudentPlatformSync WHERE user_id = ? AND platform = 'leetcode'", [testUserId]);

  // Mock successful connector response
  LeetCodeConnector.fetchProfile = async (username) => {
    return {
      success: true,
      username,
      totalSolved: 150,
      easySolved: 80,
      mediumSolved: 50,
      hardSolved: 20,
      activeDays: 45,
      submissionCalendar: { "1700000000": 5 },
      contestRating: 1650,
      globalRanking: 12345,
      contestParticipationCount: 3,
      badges: [],
      acceptanceRate: 65.5,
      topicStats: [{ tagName: 'Array', problemsSolved: 30 }],
      languageStats: [{ languageName: 'Python3', problemsSolved: 80 }],
      recentSubmissions: [{ title: 'Two Sum', statusDisplay: 'Accepted', timestamp: 1700000000 }],
      contestHistory: [
        {
          attended: true,
          rating: 1650,
          ranking: 500,
          problemsSolved: 3,
          totalProblems: 4,
          contest: { title: "Weekly Contest 350", startTime: 1700000000 }
        }
      ]
    };
  };

  const result = await syncStudentPlatform(testUserId, 'leetcode', true);
  assert.equal(result.success, true);
  assert.equal(result.status, 'Healthy');

  // Verify DB write
  const [profileRow] = await db.query(
    "SELECT current_rating, highest_rating, global_ranking, problems_solved, easy_solved, medium_solved, hard_solved, acceptance_rate, active_days FROM LeetCodeProfiles WHERE user_id = ?",
    [testUserId]
  );

  assert.ok(profileRow);
  assert.equal(Math.round(profileRow.current_rating), 1650);
  assert.equal(Math.round(profileRow.highest_rating), 1650);
  assert.equal(profileRow.global_ranking, 12345);
  assert.equal(profileRow.problems_solved, 150);
  assert.equal(profileRow.easy_solved, 80);
  assert.equal(profileRow.medium_solved, 50);
  assert.equal(profileRow.hard_solved, 20);
  assert.equal(parseFloat(profileRow.acceptance_rate), 65.5);
  assert.equal(profileRow.active_days, 45);

  // Verify sync state
  const [syncState] = await db.query(
    "SELECT sync_status, retry_count, next_retry FROM StudentPlatformSync WHERE user_id = ? AND platform = 'leetcode'",
    [testUserId]
  );
  assert.equal(syncState.sync_status, 'Healthy');
  assert.equal(syncState.retry_count, 0);
  assert.equal(syncState.next_retry, null);
});

test('Sync Pipeline Case 2: Network timeout schedules retry without deleting/modifying existing profile', async () => {
  // Mock timeout exception
  LeetCodeConnector.fetchProfile = async () => {
    throw new Error('LeetCode GraphQL request timed out');
  };

  const result = await syncStudentPlatform(testUserId, 'leetcode', true);
  assert.equal(result.success, false);
  assert.equal(result.category, 'timeout');

  // Verify existing profile row is NOT modified/deleted
  const [profileRow] = await db.query(
    "SELECT current_rating, problems_solved FROM LeetCodeProfiles WHERE user_id = ?",
    [testUserId]
  );
  assert.ok(profileRow);
  assert.equal(Math.round(profileRow.current_rating), 1650); // Kept original rating
  assert.equal(profileRow.problems_solved, 150); // Kept original solved count

  // Verify sync state updated for retry
  const [syncState] = await db.query(
    "SELECT sync_status, retry_count, next_retry, failure_category FROM StudentPlatformSync WHERE user_id = ? AND platform = 'leetcode'",
    [testUserId]
  );
  assert.equal(syncState.sync_status, 'Failed');
  assert.equal(syncState.failure_category, 'timeout');
  assert.ok(syncState.retry_count > 0);
  assert.ok(syncState.next_retry !== null);
});

test('Sync Pipeline Case 3: Cloudflare security block schedules retry', async () => {
  // Mock Cloudflare 403 Forbidden
  LeetCodeConnector.fetchProfile = async () => {
    throw new Error('LeetCode API returned status code 403 (Cloudflare block)');
  };

  const result = await syncStudentPlatform(testUserId, 'leetcode', true);
  assert.equal(result.success, false);
  assert.equal(result.category, 'rate_limiting'); // Mapped to rate_limiting

  // Verify sync state retry schedules
  const [syncState] = await db.query(
    "SELECT sync_status, retry_count, next_retry, failure_category FROM StudentPlatformSync WHERE user_id = ? AND platform = 'leetcode'",
    [testUserId]
  );
  assert.equal(syncState.sync_status, 'Failed');
  assert.equal(syncState.failure_category, 'rate_limiting');
  assert.ok(syncState.next_retry !== null);
});

test('Sync Pipeline Case 4: User not found registers failure without scheduling retry', async () => {
  // Mock User Not Found
  LeetCodeConnector.fetchProfile = async () => {
    throw new Error('User not found on LeetCode');
  };

  const result = await syncStudentPlatform(testUserId, 'leetcode', true);
  assert.equal(result.success, false);
  assert.equal(result.category, 'invalid_username');

  // Verify sync state
  const [syncState] = await db.query(
    "SELECT sync_status, retry_count, next_retry, failure_category FROM StudentPlatformSync WHERE user_id = ? AND platform = 'leetcode'",
    [testUserId]
  );
  assert.equal(syncState.sync_status, 'Failed');
  assert.equal(syncState.failure_category, 'invalid_username');
  assert.equal(syncState.next_retry, null); // NO retry scheduled for invalid_username
});

test('Sync Pipeline Case 5: Dashboard getUnifiedStudentProfile returns actual mapped metrics instead of defaults', async () => {
  // Re-run successful sync to populate valid data
  LeetCodeConnector.fetchProfile = async (username) => {
    return {
      success: true,
      username,
      totalSolved: 240,
      easySolved: 120,
      mediumSolved: 100,
      hardSolved: 20,
      activeDays: 60,
      submissionCalendar: { "1700001000": 3 },
      contestRating: 1720,
      globalRanking: 9876,
      contestParticipationCount: 5,
      badges: [],
      acceptanceRate: 58.2,
      topicStats: [{ tagName: 'Dynamic Programming', problemsSolved: 50 }],
      languageStats: [{ languageName: 'Python3', problemsSolved: 120 }],
      recentSubmissions: [{ title: 'Longest Substring', statusDisplay: 'Accepted', timestamp: 1700001000 }],
      contestHistory: [
        {
          attended: true,
          rating: 1720,
          ranking: 400,
          problemsSolved: 4,
          totalProblems: 4,
          contest: { title: "Weekly Contest 355", startTime: 1700001000 }
        }
      ]
    };
  };

  await syncStudentPlatform(testUserId, 'leetcode', true);

  // Invalidate platformAnalyticsService cache to force DB read
  const cache = require('../services/analyticsCacheService');
  cache.invalidate(cache.KEYS.STUDENT_ANALYTICS(testUserId));

  // Retrieve unified profile
  const profile = await getUnifiedStudentProfile(testUserId);
  const leetcode = profile.profiles.leetcode;

  assert.ok(leetcode);
  assert.equal(leetcode.verified, true);
  assert.equal(leetcode.username, 'sync_test_lc');
  assert.equal(leetcode.rating, 1720);
  assert.equal(leetcode.maxRating, 1720);
  assert.equal(leetcode.globalRanking, 9876);
  assert.equal(leetcode.problemsSolved, 240);
  assert.equal(leetcode.easySolved, 120);
  assert.equal(leetcode.mediumSolved, 100);
  assert.equal(leetcode.hardSolved, 20);
  assert.equal(leetcode.acceptanceRate, 58.2);
  assert.equal(leetcode.activeDays, 60);
});

after(async () => {
  // Restore original fetchProfile function
  if (originalFetchProfile) {
    LeetCodeConnector.fetchProfile = originalFetchProfile;
  }

  // Cleanup DB test entries
  await db.query("DELETE FROM Users WHERE id = ?", [testUserId]);
  await db.query("DELETE FROM LeetCodeProfiles WHERE user_id = ?", [testUserId]);
  await db.query("DELETE FROM StudentPlatformSync WHERE user_id = ?", [testUserId]);

  const pool = db.getPool();
  if (pool) {
    await pool.end();
  }
});
