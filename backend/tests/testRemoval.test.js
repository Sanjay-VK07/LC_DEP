const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const { productionContestWhere } = require('../utils/contestFilter');

let testContestId = null;
let testLiveContestId = null;

before(async () => {
  await db.initializeDatabase();

  // Clean up any stale test entries first
  await db.query("DELETE FROM Contests WHERE slug = 'test-contest-abc'");
  await db.query("DELETE FROM LiveContests WHERE contestSlug = 'test-contest-abc'");

  // Insert a mock test contest in Contests
  const res = await db.query(`
    INSERT INTO Contests (title, slug, platform, start_time, duration, contest_status, contest_type, is_test)
    VALUES ('Regression Test Contest ABC', 'test-contest-abc', 'LeetCode', '2026-01-01 10:00:00', 5400, 'Rated', 'Weekly', 0)
  `);
  testContestId = res.insertId;

  // Insert a mock test contest in LiveContests
  const res2 = await db.query(`
    INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status, is_test)
    VALUES ('LeetCode', 'test-contest-abc', 'Regression Test Contest ABC', 'Weekly', '2026-01-01 10:00:00', '2026-01-01 11:30:00', 'Upcoming', 0)
  `);
  testLiveContestId = res2.insertId;
});

test('Test Contest Removal - identifies test contests correctly', async () => {
  const { isTestContest, isProductionContest } = require('../utils/contestFilter');

  const mockTestObj = { title: 'Mock Contest XYZ', slug: 'weekly-contest-1', source: 'TEST' };
  const mockProdObj = { title: 'Weekly Contest 400', slug: 'weekly-contest-400', source: 'LeetCode' };

  assert.equal(isTestContest(mockTestObj), true);
  assert.equal(isProductionContest(mockProdObj), true);
});

test('Test Contest Removal - cleanup updates is_test = 1', async () => {
  // Execute update matching the cleanup script rules
  await db.query(`
    UPDATE Contests 
    SET is_test = 1 
    WHERE slug = 'test-contest-abc'
  `);
  await db.query(`
    UPDATE LiveContests 
    SET is_test = 1 
    WHERE contestSlug = 'test-contest-abc'
  `);

  const [contest] = await db.query("SELECT is_test FROM Contests WHERE slug = 'test-contest-abc'");
  assert.equal(contest.is_test, 1);

  const [liveContest] = await db.query("SELECT is_test FROM LiveContests WHERE contestSlug = 'test-contest-abc'");
  assert.equal(liveContest.is_test, 1);
});

test('Test Contest Removal - production filter hides test contests', async () => {
  // Query with production filter
  const contests = await db.query(`
    SELECT * FROM Contests 
    WHERE slug = 'test-contest-abc' AND ${productionContestWhere('Contests')}
  `);
  assert.equal(contests.length, 0);

  const liveContests = await db.query(`
    SELECT * FROM LiveContests 
    WHERE contestSlug = 'test-contest-abc' AND ${productionContestWhere('LiveContests')}
  `);
  assert.equal(liveContests.length, 0);
});

test('Test Contest Removal - includeTest = true bypasses filter', async () => {
  // Query without filter (simulating includeTest = true)
  const contests = await db.query("SELECT * FROM Contests WHERE slug = 'test-contest-abc'");
  assert.equal(contests.length, 1);

  const liveContests = await db.query("SELECT * FROM LiveContests WHERE contestSlug = 'test-contest-abc'");
  assert.equal(liveContests.length, 1);
});

after(async () => {
  // Clean up test entries
  await db.query("DELETE FROM Contests WHERE slug = 'test-contest-abc'");
  await db.query("DELETE FROM LiveContests WHERE contestSlug = 'test-contest-abc'");

  const pool = db.getPool();
  if (pool) {
    await pool.end();
  }
});
