const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');

// Import files to test
const { getAdapter } = require('../services/adapters/AdapterFactory');
const BaseAdapter = require('../services/adapters/BaseAdapter');
const LeetCodeAdapter = require('../services/adapters/LeetCodeAdapter');
const CodeforcesAdapter = require('../services/adapters/CodeforcesAdapter');
const CodeChefAdapter = require('../services/adapters/CodeChefAdapter');
const HackerRankAdapter = require('../services/adapters/HackerRankAdapter');
const ContestAttendanceSyncService = require('../services/ContestAttendanceSyncService');
const jobQueue = require('../services/jobQueueService');

test('AdapterFactory - resolves platforms correctly', () => {
  const leetcode = getAdapter('leetcode');
  assert.ok(leetcode instanceof LeetCodeAdapter);

  const codeforces = getAdapter('Codeforces');
  assert.ok(codeforces instanceof CodeforcesAdapter);

  const codechef = getAdapter('CODECHEF');
  assert.ok(codechef instanceof CodeChefAdapter);

  const hackerrank = getAdapter('hackerrank ');
  assert.ok(hackerrank instanceof HackerRankAdapter);

  assert.throws(() => getAdapter('unknown_platform'), /Platform adapter not found/);
});

test('Adapters - implement common interface methods', () => {
  const platforms = ['leetcode', 'codeforces', 'codechef', 'hackerrank'];
  for (const plat of platforms) {
    const adapter = getAdapter(plat);
    assert.ok(adapter instanceof BaseAdapter);
    assert.equal(typeof adapter.getProfile, 'function');
    assert.equal(typeof adapter.getContestHistory, 'function');
    assert.equal(typeof adapter.getContestParticipants, 'function');
    assert.equal(typeof adapter.getUpcomingContests, 'function');
  }
});

test('ContestAttendanceSyncService - runs attendance sync successfully', async () => {
  await db.initializeDatabase();

  // 1. Setup mock contest in DB
  const slug = `test-sync-contest-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Test Contest', ?, 'Weekly', 101, NOW(), 5400, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  // 2. Setup mock student in DB
  const regNo = `REG-${Date.now()}`;
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Ganesh Test User', ?, 'DEC', 'A', 'ganesh_test_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')
  `, [regNo]);

  const [studentRow] = await db.query("SELECT id FROM Users WHERE roll_no = ?", [regNo]);
  const studentId = studentRow.id;

  // Mock the LeetCode adapter to return the participant
  const leetcodeAdapter = getAdapter('leetcode');
  const originalGetContestParticipants = leetcodeAdapter.getContestParticipants;
  leetcodeAdapter.getContestParticipants = async (cId) => {
    return [
      { username: 'ganesh_test_user', rank: 12, score: 4.00, finishTime: 1200 }
    ];
  };

  try {
    // 3. Run sync service
    const result = await ContestAttendanceSyncService.syncContestAttendance(contestId, {
      pass: 4
    });

    assert.equal(result.success, true);
    assert.equal(result.processedStudents > 0, true);

    // 4. Verify AttendanceRecords table has PRESENT record
    const attRecs = await db.query(
      "SELECT attendance_status, `rank`, score FROM AttendanceRecords WHERE user_id = ? AND contest_id = ?",
      [studentId, contestId]
    );
    assert.equal(attRecs.length, 1);
    assert.equal(attRecs[0].attendance_status, 'PRESENT');
    assert.equal(attRecs[0].rank, 12);
    assert.equal(parseFloat(attRecs[0].score), 4.00);

    // 5. Verify ContestAttendance has Present record
    const contAtt = await db.query(
      "SELECT attendanceStatus, `rank`, score FROM ContestAttendance WHERE studentId = ? AND contestId = (SELECT id FROM LiveContests WHERE contestSlug = ?)",
      [studentId, slug]
    );
    assert.equal(contAtt.length, 1);
    assert.equal(contAtt[0].attendanceStatus, 'Present');
    assert.equal(contAtt[0].rank, 12);
  } finally {
    // Restore original method
    leetcodeAdapter.getContestParticipants = originalGetContestParticipants;
    // Clean up
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
  }
});

test('ContestAttendanceSyncService - marks Unknown on adapter failure', async () => {
  await db.initializeDatabase();

  const slug = `test-fail-contest-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Fail Contest', ?, 'Weekly', 102, NOW(), 5400, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  const regNo = `REG-FAIL-${Date.now()}`;
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Ganesh Fail User', ?, 'DEC', 'A', 'ganesh_fail_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')
  `, [regNo]);

  const [studentRow] = await db.query("SELECT id FROM Users WHERE roll_no = ?", [regNo]);
  const studentId = studentRow.id;

  // Seed an existing PRESENT record in AttendanceRecords to verify it is NOT overwritten
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source)
    VALUES (?, ?, 'Fail Contest', ?, NOW(), 'RATED', 'PRESENT', 'AUTO')
  `, [studentId, contestId, slug]);

  const leetcodeAdapter = getAdapter('leetcode');
  const originalGetContestParticipants = leetcodeAdapter.getContestParticipants;
  
  // Force adapter to fail
  leetcodeAdapter.getContestParticipants = async (cId) => {
    throw new Error('Platform API is rate limited or unavailable');
  };

  try {
    const result = await ContestAttendanceSyncService.syncContestAttendance(contestId, {
      pass: 4
    });

    assert.equal(result.success, true);
    assert.equal(result.fetchSuccess, false);

    // Verify student attendance is still PRESENT in legacy AttendanceRecords (not marked ABSENT due to API failure)
    const attRecs = await db.query(
      "SELECT attendance_status FROM AttendanceRecords WHERE user_id = ? AND contest_id = ?",
      [studentId, contestId]
    );
    assert.equal(attRecs.length, 1);
    assert.equal(attRecs[0].attendance_status, 'PRESENT');

    const contAtt = await db.query(
      "SELECT attendanceStatus FROM ContestAttendance WHERE studentId = ? AND contestId = (SELECT id FROM LiveContests WHERE contestSlug = ?)",
      [studentId, slug]
    );
    assert.equal(contAtt.length, 1);
    assert.equal(contAtt[0].attendanceStatus, 'Unknown');
  } finally {
    leetcodeAdapter.getContestParticipants = originalGetContestParticipants;
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
  }
});

after(async () => {
  const pool = db.getPool();
  if (pool) {
    await pool.end();
  }
  process.exit(0);
});
