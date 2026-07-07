const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const { getAdapter } = require('../services/adapters/AdapterFactory');
const ContestAttendanceSyncService = require('../services/ContestAttendanceSyncService');

test('Attendance Regression - Official participant found -> PRESENT', async () => {
  await db.initializeDatabase();

  const slug = `test-reg-present-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Regression Test Contest 1', ?, 'Weekly', 201, NOW(), 5400, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  const regNo = `REG-PRES-${Date.now()}`;
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Ganesh Present Student', ?, 'DEC', 'A', 'ganesh_pres_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')
  `, [regNo]);

  const [studentRow] = await db.query("SELECT id FROM Users WHERE roll_no = ?", [regNo]);
  const studentId = studentRow.id;

  const leetcodeAdapter = getAdapter('leetcode');
  const originalGetContestParticipants = leetcodeAdapter.getContestParticipants;
  leetcodeAdapter.getContestParticipants = async (cId) => {
    return [
      { username: 'ganesh_pres_user', rank: 5, score: 5.00, finishTime: 1000 }
    ];
  };

  try {
    const result = await ContestAttendanceSyncService.syncContestAttendance(contestId, { pass: 4 });
    assert.equal(result.success, true);

    const attRecs = await db.query(
      "SELECT attendance_status, `rank`, score FROM AttendanceRecords WHERE user_id = ? AND contest_id = ?",
      [studentId, contestId]
    );
    assert.equal(attRecs.length, 1);
    assert.equal(attRecs[0].attendance_status, 'PRESENT');
    assert.equal(attRecs[0].rank, 5);
  } finally {
    leetcodeAdapter.getContestParticipants = originalGetContestParticipants;
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
  }
});

test('Attendance Regression - Participant missing -> ABSENT', async () => {
  await db.initializeDatabase();

  const slug = `test-reg-absent-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Regression Test Contest 2', ?, 'Weekly', 202, NOW(), 5400, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  const regNo = `REG-ABSE-${Date.now()}`;
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Ganesh Absent Student', ?, 'DEC', 'A', 'ganesh_absent_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')
  `, [regNo]);

  const [studentRow] = await db.query("SELECT id FROM Users WHERE roll_no = ?", [regNo]);
  const studentId = studentRow.id;

  const leetcodeAdapter = getAdapter('leetcode');
  const originalGetContestParticipants = leetcodeAdapter.getContestParticipants;
  leetcodeAdapter.getContestParticipants = async (cId) => {
    return [
      { username: 'someone_else', rank: 1, score: 8.00, finishTime: 500 }
    ];
  };

  try {
    const result = await ContestAttendanceSyncService.syncContestAttendance(contestId, { pass: 4 });
    assert.equal(result.success, true);

    const attRecs = await db.query(
      "SELECT attendance_status FROM AttendanceRecords WHERE user_id = ? AND contest_id = ?",
      [studentId, contestId]
    );
    assert.equal(attRecs.length, 1);
    assert.equal(attRecs[0].attendance_status, 'ABSENT');
  } finally {
    leetcodeAdapter.getContestParticipants = originalGetContestParticipants;
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
  }
});

test('Attendance Regression - Manual override -> PRESERVED', async () => {
  await db.initializeDatabase();

  const slug = `test-reg-override-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Regression Test Contest 3', ?, 'Weekly', 203, NOW(), 5400, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  const regNo = `REG-OVER-${Date.now()}`;
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Ganesh Override Student', ?, 'DEC', 'A', 'ganesh_over_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')
  `, [regNo]);

  const [studentRow] = await db.query("SELECT id FROM Users WHERE roll_no = ?", [regNo]);
  const studentId = studentRow.id;

  // Insert MANUAL override
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source)
    VALUES (?, ?, 'Regression Test Contest 3', ?, NOW(), 'RATED', 'PRESENT', 'MANUAL')
  `, [studentId, contestId, slug]);

  const leetcodeAdapter = getAdapter('leetcode');
  const originalGetContestParticipants = leetcodeAdapter.getContestParticipants;
  // Adapter returns empty/absent
  leetcodeAdapter.getContestParticipants = async (cId) => {
    return [];
  };

  try {
    const result = await ContestAttendanceSyncService.syncContestAttendance(contestId, { pass: 4 });
    
    // Since result is SYNC_SKIPPED due to 0 participants returned, let's verify that manual override is still PRESERVED
    const attRecs = await db.query(
      "SELECT attendance_status, attendance_source FROM AttendanceRecords WHERE user_id = ? AND contest_id = ?",
      [studentId, contestId]
    );
    assert.equal(attRecs.length, 1);
    assert.equal(attRecs[0].attendance_status, 'PRESENT');
    assert.equal(attRecs[0].attendance_source, 'MANUAL');
  } finally {
    leetcodeAdapter.getContestParticipants = originalGetContestParticipants;
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
  }
});

test('Attendance Regression - Zero participants returned -> Sync skipped', async () => {
  await db.initializeDatabase();

  const slug = `test-reg-zero-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Regression Test Contest 4', ?, 'Weekly', 204, NOW(), 5400, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  const leetcodeAdapter = getAdapter('leetcode');
  const originalGetContestParticipants = leetcodeAdapter.getContestParticipants;
  leetcodeAdapter.getContestParticipants = async (cId) => {
    return []; // 0 participants
  };

  try {
    const result = await ContestAttendanceSyncService.syncContestAttendance(contestId, { pass: 4 });
    assert.equal(result, 'SYNC_SKIPPED');
  } finally {
    leetcodeAdapter.getContestParticipants = originalGetContestParticipants;
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
  }
});

after(async () => {
  const pool = db.getPool();
  if (pool) {
    await pool.end();
  }
});
