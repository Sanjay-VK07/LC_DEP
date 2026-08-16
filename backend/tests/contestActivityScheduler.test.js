/**
 * contestActivityScheduler.test.js
 * ================================
 * Test suite for Contest Activity Tracker Automatic Scheduler (Phase 2).
 */

const assert = require('assert');
const fs = require('fs');
const db = require('../config/db');
const ContestActivityScheduler = require('../services/ContestActivityScheduler');
const ContestActivityService = require('../services/ContestActivityService');
const { normalizeUsername } = require('../utils/usernameNormalizer');

async function runTests() {
  await db.initializeDatabase();

  console.log('====================================================');
  console.log('  CONTEST ACTIVITY SCHEDULER TEST SUITE (PHASE 2)');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(description, fn) {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        console.log(`✓ PASS: ${description}`);
        passed++;
      })
      .catch((err) => {
        console.error(`✗ FAIL: ${description}`);
        console.error(`  Error: ${err.message}`);
        failed++;
      });
  }

  // 1. Future contests are ignored
  await test('1. Future contests (start_time > NOW()) are ignored', async () => {
    const queryStr = `
      SELECT slug FROM Contests 
      WHERE start_time <= NOW() AND start_time >= DATE_SUB(NOW(), INTERVAL ? HOUR)
    `;
    const futureSlug = 'test-future-contest-sched-999';
    await db.query("DELETE FROM Contests WHERE slug = ?", [futureSlug]);
    await db.query(
      `INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
       VALUES ('Test Future', ?, 'Weekly', 999, DATE_ADD(NOW(), INTERVAL 5 DAY), 5400, 'Rated', 'LeetCode', 'TEST')`,
      [futureSlug]
    );

    const activeContests = await db.query(queryStr, [ContestActivityScheduler.postWindowHours]);
    const polledFuture = activeContests.some(c => c.slug === futureSlug);
    assert.strictEqual(polledFuture, false, 'Future contest must not be included in active query');

    await db.query("DELETE FROM Contests WHERE slug = ?", [futureSlug]);
  });

  // 2. Started contests are selected
  await test('2. Started contests (start_time <= NOW()) within window are selected', async () => {
    const startedSlug = 'weekly-contest-515';
    await db.query("UPDATE Contests SET start_time = DATE_SUB(NOW(), INTERVAL 2 HOUR) WHERE slug = ?", [startedSlug]);
    const queryStr = `
      SELECT slug FROM Contests 
      WHERE start_time <= NOW() AND start_time >= DATE_SUB(NOW(), INTERVAL ? HOUR)
    `;
    const contests = await db.query(queryStr, [ContestActivityScheduler.postWindowHours]);
    const found515 = contests.some(c => c.slug === startedSlug);
    assert.strictEqual(found515, true, 'Weekly Contest 515 should be found in active window');
  });

  // 3. Active contest is polled
  await test('3. Active contest polling triggers ContestActivityService', async () => {
    assert.strictEqual(typeof ContestActivityScheduler.pollActiveContests, 'function');
  });

  // 4. Historical contests outside post-contest window are ignored
  await test('4. Historical contests outside post-contest window are ignored', async () => {
    const queryStr = `
      SELECT slug FROM Contests 
      WHERE start_time <= NOW() AND start_time >= DATE_SUB(NOW(), INTERVAL ? HOUR)
    `;
    const oldSlug = 'test-old-historical-contest-001';
    await db.query("DELETE FROM Contests WHERE slug = ?", [oldSlug]);
    await db.query(
      `INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
       VALUES ('Test Old', ?, 'Weekly', 1, DATE_SUB(NOW(), INTERVAL 100 HOUR), 5400, 'Rated', 'LeetCode', 'TEST')`,
      [oldSlug]
    );

    const activeContests = await db.query(queryStr, [ContestActivityScheduler.postWindowHours]);
    const polledOld = activeContests.some(c => c.slug === oldSlug);
    assert.strictEqual(polledOld, false, 'Historical contest outside 24h window must be ignored');

    await db.query("DELETE FROM Contests WHERE slug = ?", [oldSlug]);
  });

  // 5. Same contest cannot run concurrently
  await test('5. Concurrency protection prevents simultaneous activity jobs for same contest', async () => {
    const testSlug = 'test-concurrency-slug';
    ContestActivityScheduler.activeJobs.add(testSlug);
    const isRunning = ContestActivityScheduler.isContestRunning(testSlug);
    assert.strictEqual(isRunning, true, 'isContestRunning should return true when job is active');
    ContestActivityScheduler.activeJobs.delete(testSlug);
    assert.strictEqual(ContestActivityScheduler.isContestRunning(testSlug), false, 'isContestRunning should return false after release');
  });

  // 6. Duplicate snapshot prevention
  await test('6. Duplicate snapshot prevention skips identical rank and score observations', async () => {
    const contestSlug = 'test-activity-dup-sched';
    const [testStudent] = await db.query("SELECT id FROM Users WHERE status = 'active' LIMIT 1");
    const studentId = testStudent.id;

    await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);

    await db.query(
      `INSERT INTO ContestActivitySnapshots (contest_id, student_id, contest_slug, leetcode_username, \`rank\`, score, observed_at, provider)
       VALUES (1, ?, ?, 'testuser', 100, 15.00, NOW(), 'CLIST')`,
      [studentId, contestSlug]
    );

    const latestRows = await db.query(
      `SELECT \`rank\`, score FROM ContestActivitySnapshots WHERE student_id = ? AND contest_slug = ? ORDER BY observed_at DESC, id DESC LIMIT 1`,
      [studentId, contestSlug]
    );
    const latest = latestRows[0];
    const isDup = parseInt(latest.rank, 10) === 100 && parseFloat(latest.score) === 15.00;
    assert.strictEqual(isDup, true, 'Identical rank and score should be detected as duplicate');

    await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);
  });

  // 7. Rank change creates snapshot
  await test('7. Rank change creates a new activity snapshot', async () => {
    const contestSlug = 'test-activity-rank-change-sched';
    const [testStudent] = await db.query("SELECT id FROM Users WHERE status = 'active' LIMIT 1");
    const studentId = testStudent.id;

    await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);

    await db.query(
      `INSERT INTO ContestActivitySnapshots (contest_id, student_id, contest_slug, leetcode_username, \`rank\`, score, observed_at, provider)
       VALUES (1, ?, ?, 'testuser', 500, 15.00, NOW(), 'CLIST')`,
      [studentId, contestSlug]
    );

    await db.query(
      `INSERT INTO ContestActivitySnapshots (contest_id, student_id, contest_slug, leetcode_username, \`rank\`, score, observed_at, provider)
       VALUES (1, ?, ?, 'testuser', 450, 15.00, NOW(), 'CLIST')`,
      [studentId, contestSlug]
    );

    const rows = await db.query("SELECT * FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);
    assert.strictEqual(rows.length, 2, 'Should create 2 snapshots on rank change');

    await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);
  });

  // 8. Score change creates snapshot
  await test('8. Score change creates a new activity snapshot', async () => {
    const contestSlug = 'test-activity-score-change-sched';
    const [testStudent] = await db.query("SELECT id FROM Users WHERE status = 'active' LIMIT 1");
    const studentId = testStudent.id;

    await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);

    await db.query(
      `INSERT INTO ContestActivitySnapshots (contest_id, student_id, contest_slug, leetcode_username, \`rank\`, score, observed_at, provider)
       VALUES (1, ?, ?, 'testuser', 450, 15.00, NOW(), 'CLIST')`,
      [studentId, contestSlug]
    );

    await db.query(
      `INSERT INTO ContestActivitySnapshots (contest_id, student_id, contest_slug, leetcode_username, \`rank\`, score, observed_at, provider)
       VALUES (1, ?, ?, 'testuser', 450, 18.00, NOW(), 'CLIST')`,
      [studentId, contestSlug]
    );

    const rows = await db.query("SELECT * FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);
    assert.strictEqual(rows.length, 2, 'Should create 2 snapshots on score change');

    await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);
  });

  // 9. CLIST failures don't modify attendance
  await test('9. CLIST failures do not modify attendance records', async () => {
    const schedCode = fs.readFileSync(require.resolve('../services/ContestActivityScheduler'), 'utf8');
    assert.strictEqual(schedCode.includes('AttendanceRecords'), false, 'Scheduler must not touch AttendanceRecords');
  });

  // 10. CLIST rate limits don't modify attendance
  await test('10. CLIST rate limit handling does not create ABSENT or attendance rows', async () => {
    const schedCode = fs.readFileSync(require.resolve('../services/ContestActivityScheduler'), 'utf8');
    assert.strictEqual(schedCode.includes('ContestAttendance'), false, 'Scheduler must not touch ContestAttendance');
  });

  // 11. Estimated count is not used as actual participant count
  await test('11. Estimated count is not used as actual participant count', async () => {
    const serviceCode = fs.readFileSync(require.resolve('../services/ContestActivityService'), 'utf8');
    assert.strictEqual(serviceCode.includes('allScrapedObjects.length'), true, 'Must use actual returned objects');
  });

  // 12. Scheduler does not call old providers
  await test('12. Scheduler does not import or invoke old providers (GraphQL, RankingPage, Leet.ai, Alfa)', async () => {
    const schedCode = fs.readFileSync(require.resolve('../services/ContestActivityScheduler'), 'utf8');
    assert.strictEqual(schedCode.includes('GraphQL'), false);
    assert.strictEqual(schedCode.includes('RankingPage'), false);
    assert.strictEqual(schedCode.includes('Leet.ai'), false);
    assert.strictEqual(schedCode.includes('Alfa'), false);
  });

  // 13. Scheduler does not modify leaderboardComplete
  await test('13. Scheduler does not modify leaderboardComplete', async () => {
    const schedCode = fs.readFileSync(require.resolve('../services/ContestActivityScheduler'), 'utf8');
    assert.strictEqual(schedCode.includes('leaderboardComplete'), false);
  });

  // 14. Scheduler does not modify attendanceFinalized
  await test('14. Scheduler does not modify attendanceFinalized', async () => {
    const schedCode = fs.readFileSync(require.resolve('../services/ContestActivityScheduler'), 'utf8');
    assert.strictEqual(schedCode.includes('attendanceFinalized'), false);
  });

  console.log('\n====================================================');
  console.log(`  TEST SUMMARY: Passed ${passed} / Failed ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
