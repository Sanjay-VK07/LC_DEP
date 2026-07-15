const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const { getAdapter } = require('../services/adapters/AdapterFactory');
const ContestAttendanceSyncService = require('../services/ContestAttendanceSyncService');

before(async () => {
  await db.initializeDatabase();
  await db.query("DELETE FROM Users WHERE leetcode_username LIKE 'ganesh_%'");
});

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

test('Attendance Regression - ContestParticipants only -> PRESENT', async () => {
  await db.initializeDatabase();

  const slug = `test-reg-participants-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Regression Test Contest CP Only', ?, 'Weekly', 301, NOW(), 5400, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  const regNo = `REG-CP-${Date.now()}`;
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Ganesh CP Student', ?, 'DEC', 'A', 'ganesh_cp_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')
  `, [regNo]);

  const [studentRow] = await db.query("SELECT id FROM Users WHERE roll_no = ?", [regNo]);
  const studentId = studentRow.id;

  // Insert into ContestParticipants (no rank, score=0, finish_time=null, but exists)
  await db.query(`
    INSERT INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, page_number)
    VALUES (?, 'ganesh_cp_user', 0, 0.00, 0, 0, 1)
  `, [slug]);

  const leetcodeAdapter = getAdapter('leetcode');
  const originalGetContestParticipants = leetcodeAdapter.getContestParticipants;
  leetcodeAdapter.getContestParticipants = async (cId) => {
    return [
      { username: 'ganesh_cp_user', rank: 0, score: 0.00, finishTime: 0 }
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
    assert.equal(attRecs[0].attendance_status, 'PRESENT');
  } finally {
    leetcodeAdapter.getContestParticipants = originalGetContestParticipants;
    await db.query("DELETE FROM ContestParticipants WHERE contest_slug = ?", [slug]);
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
  }
});

test('Attendance Regression - Rank only -> PRESENT', async () => {
  await db.initializeDatabase();

  const slug = `test-reg-rank-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Regression Test Contest Rank Only', ?, 'Weekly', 302, NOW(), 5400, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  const regNo = `REG-RANK-${Date.now()}`;
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Ganesh Rank Student', ?, 'DEC', 'A', 'ganesh_rank_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')
  `, [regNo]);

  const [studentRow] = await db.query("SELECT id FROM Users WHERE roll_no = ?", [regNo]);
  const studentId = studentRow.id;

  // No ContestParticipants, but existing record has rank in ContestAttendance
  const liveRows = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
  let liveContestId;
  if (liveRows.length > 0) {
    liveContestId = liveRows[0].id;
  } else {
    const liveIns = await db.query(`
      INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
      VALUES ('LeetCode', ?, 'Regression Test Contest Rank Only', 'Weekly', NOW(), NOW(), 'Completed')
    `, [slug]);
    liveContestId = liveIns.insertId || liveIns[0]?.insertId;
  }

  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, score, penalty)
    VALUES (?, ?, 'ganesh_rank_user', 'Absent', 71, 0.00, 0)
  `, [liveContestId, studentId]);

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
      "SELECT attendance_status, \`rank\` FROM AttendanceRecords WHERE user_id = ? AND contest_id = ?",
      [studentId, contestId]
    );
    assert.equal(attRecs.length, 1);
    assert.equal(attRecs[0].attendance_status, 'PRESENT');
    assert.equal(attRecs[0].rank, 71);
  } finally {
    leetcodeAdapter.getContestParticipants = originalGetContestParticipants;
    await db.query("DELETE FROM ContestAttendance WHERE contestId = ?", [liveContestId]);
    await db.query("DELETE FROM LiveContests WHERE id = ?", [liveContestId]);
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
  }
});

test('Attendance Regression - Score only -> PRESENT', async () => {
  await db.initializeDatabase();

  const slug = `test-reg-score-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Regression Test Contest Score Only', ?, 'Weekly', 303, NOW(), 5400, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  const regNo = `REG-SCORE-${Date.now()}`;
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Ganesh Score Student', ?, 'DEC', 'A', 'ganesh_score_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')
  `, [regNo]);

  const [studentRow] = await db.query("SELECT id FROM Users WHERE roll_no = ?", [regNo]);
  const studentId = studentRow.id;

  const liveRows = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
  let liveContestId;
  if (liveRows.length > 0) {
    liveContestId = liveRows[0].id;
  } else {
    const liveIns = await db.query(`
      INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
      VALUES ('LeetCode', ?, 'Regression Test Contest Score Only', 'Weekly', NOW(), NOW(), 'Completed')
    `, [slug]);
    liveContestId = liveIns.insertId || liveIns[0]?.insertId;
  }

  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, score, penalty)
    VALUES (?, ?, 'ganesh_score_user', 'Absent', null, 18.00, 0)
  `, [liveContestId, studentId]);

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
      "SELECT attendance_status, score FROM AttendanceRecords WHERE user_id = ? AND contest_id = ?",
      [studentId, contestId]
    );
    assert.equal(attRecs.length, 1);
    assert.equal(attRecs[0].attendance_status, 'PRESENT');
    assert.equal(parseFloat(attRecs[0].score), 18.00);
  } finally {
    leetcodeAdapter.getContestParticipants = originalGetContestParticipants;
    await db.query("DELETE FROM ContestAttendance WHERE contestId = ?", [liveContestId]);
    await db.query("DELETE FROM LiveContests WHERE id = ?", [liveContestId]);
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
  }
});

test('Attendance Regression - FinishTime only -> PRESENT', async () => {
  await db.initializeDatabase();

  const slug = `test-reg-finish-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Regression Test Contest Finish Only', ?, 'Weekly', 304, NOW(), 5400, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  const regNo = `REG-FINISH-${Date.now()}`;
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Ganesh Finish Student', ?, 'DEC', 'A', 'ganesh_finish_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')
  `, [regNo]);

  const [studentRow] = await db.query("SELECT id FROM Users WHERE roll_no = ?", [regNo]);
  const studentId = studentRow.id;

  const liveRows = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
  let liveContestId;
  if (liveRows.length > 0) {
    liveContestId = liveRows[0].id;
  } else {
    const liveIns = await db.query(`
      INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
      VALUES ('LeetCode', ?, 'Regression Test Contest Finish Only', 'Weekly', NOW(), NOW(), 'Completed')
    `, [slug]);
    liveContestId = liveIns.insertId || liveIns[0]?.insertId;
  }

  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, score, penalty)
    VALUES (?, ?, 'ganesh_finish_user', 'Absent', null, 0.00, 504)
  `, [liveContestId, studentId]);

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
    assert.equal(attRecs[0].attendance_status, 'PRESENT');
  } finally {
    leetcodeAdapter.getContestParticipants = originalGetContestParticipants;
    await db.query("DELETE FROM ContestAttendance WHERE contestId = ?", [liveContestId]);
    await db.query("DELETE FROM LiveContests WHERE id = ?", [liveContestId]);
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
  }
});

test('Attendance Regression - ContestParticipants + stale ABSENT -> PRESENT', async () => {
  await db.initializeDatabase();

  const slug = `test-reg-stale-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Regression Test Contest Stale', ?, 'Weekly', 305, NOW(), 5400, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  const regNo = `REG-STALE-${Date.now()}`;
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Ganesh Stale Student', ?, 'DEC', 'A', 'ganesh_stale_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')
  `, [regNo]);

  const [studentRow] = await db.query("SELECT id FROM Users WHERE roll_no = ?", [regNo]);
  const studentId = studentRow.id;

  // Insert stale ABSENT record
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source)
    VALUES (?, ?, 'Regression Test Contest Stale', ?, NOW(), 'RATED', 'ABSENT', 'AUTO')
  `, [studentId, contestId, slug]);

  const liveRows = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
  let liveContestId;
  if (liveRows.length > 0) {
    liveContestId = liveRows[0].id;
  } else {
    const liveIns = await db.query(`
      INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
      VALUES ('LeetCode', ?, 'Regression Test Contest Stale', 'Weekly', NOW(), NOW(), 'Completed')
    `, [slug]);
    liveContestId = liveIns.insertId || liveIns[0]?.insertId;
  }

  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, score, penalty)
    VALUES (?, ?, 'ganesh_stale_user', 'Absent', null, 0.00, 0)
  `, [liveContestId, studentId]);

  // Exists in ContestParticipants
  await db.query(`
    INSERT INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, page_number)
    VALUES (?, 'ganesh_stale_user', 4188, 5.00, 1, 500, 1)
  `, [slug]);

  const leetcodeAdapter = getAdapter('leetcode');
  const originalGetContestParticipants = leetcodeAdapter.getContestParticipants;
  leetcodeAdapter.getContestParticipants = async (cId) => {
    return [
      { username: 'ganesh_stale_user', rank: 4188, score: 5.00, finishTime: 500 }
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
    assert.equal(attRecs[0].attendance_status, 'PRESENT');
  } finally {
    leetcodeAdapter.getContestParticipants = originalGetContestParticipants;
    await db.query("DELETE FROM ContestParticipants WHERE contest_slug = ?", [slug]);
    await db.query("DELETE FROM ContestAttendance WHERE contestId = ?", [liveContestId]);
    await db.query("DELETE FROM LiveContests WHERE id = ?", [liveContestId]);
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
  }
});

test('Attendance Regression - Recovery updates existing incorrect ABSENT records', async () => {
  await db.initializeDatabase();

  const slug = `test-reg-recovery-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Regression Test Contest Recovery', ?, 'Weekly', 306, NOW(), 5400, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  const regNo = `REG-REC-${Date.now()}`;
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Ganesh Recovery Student', ?, 'DEC', 'A', 'ganesh_rec_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')
  `, [regNo]);

  const [studentRow] = await db.query("SELECT id FROM Users WHERE roll_no = ?", [regNo]);
  const studentId = studentRow.id;

  // Insert incorrect ABSENT record (with valid rank)
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source, \`rank\`, score)
    VALUES (?, ?, 'Regression Test Contest Recovery', ?, NOW(), 'RATED', 'ABSENT', 'AUTO', 10774, 5.00)
  `, [studentId, contestId, slug]);

  const liveRows = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
  let liveContestId;
  if (liveRows.length > 0) {
    liveContestId = liveRows[0].id;
  } else {
    const liveIns = await db.query(`
      INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
      VALUES ('LeetCode', ?, 'Regression Test Contest Recovery', 'Weekly', NOW(), NOW(), 'Completed')
    `, [slug]);
    liveContestId = liveIns.insertId || liveIns[0]?.insertId;
  }

  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, score, penalty)
    VALUES (?, ?, 'ganesh_rec_user', 'Absent', 10774, 5.00, 0)
  `, [liveContestId, studentId]);

  // Run startupRecovery
  const startupRecovery = require('../services/startupRecovery');
  
  try {
    await startupRecovery.run();

    const attRecs = await db.query(
      "SELECT attendance_status FROM AttendanceRecords WHERE user_id = ? AND contest_id = ?",
      [studentId, contestId]
    );
    assert.equal(attRecs.length, 1);
    assert.equal(attRecs[0].attendance_status, 'PRESENT');

    const caRecs = await db.query(
      "SELECT attendanceStatus FROM ContestAttendance WHERE studentId = ? AND contestId = ?",
      [studentId, liveContestId]
    );
    assert.equal(caRecs.length, 1);
    assert.equal(caRecs[0].attendanceStatus, 'Present');
  } finally {
    await db.query("DELETE FROM ContestAttendance WHERE contestId = ?", [liveContestId]);
    await db.query("DELETE FROM LiveContests WHERE id = ?", [liveContestId]);
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
  }
});

test('Attendance Regression - Casing Normalization Utility checks', async () => {
  const { normalizeAttendanceStatus } = require('../utils/attendanceNormalizer');
  assert.equal(normalizeAttendanceStatus('Present'), 'PRESENT');
  assert.equal(normalizeAttendanceStatus('present'), 'PRESENT');
  assert.equal(normalizeAttendanceStatus('PRESENT'), 'PRESENT');
  assert.equal(normalizeAttendanceStatus('PRESENT ✅'), 'PRESENT');
  assert.equal(normalizeAttendanceStatus('Absent'), 'ABSENT');
  assert.equal(normalizeAttendanceStatus('absent'), 'ABSENT');
  assert.equal(normalizeAttendanceStatus('ABSENT'), 'ABSENT');
  assert.equal(normalizeAttendanceStatus('ABSENT ❌'), 'ABSENT');
  assert.equal(normalizeAttendanceStatus('Pending'), 'ABSENT');
  assert.equal(normalizeAttendanceStatus('Unknown'), 'ABSENT');
  assert.equal(normalizeAttendanceStatus(null), 'ABSENT');
  assert.equal(normalizeAttendanceStatus(''), 'ABSENT');
});

after(async () => {
  await db.closePool();
});
