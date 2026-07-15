const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const contestmasterController = require('../controllers/contestmasterController');
const attendanceController = require('../controllers/attendanceController');
const attendanceService = require('../services/attendanceService');

// Helper to construct mock express req and res
function makeMockReqRes(params = {}, query = {}, body = {}) {
  let responseData = null;
  let statusCode = 200;

  const req = {
    params,
    query,
    body
  };

  const res = {
    json(data) {
      responseData = data;
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    get data() {
      return responseData;
    },
    get statusCode() {
      return statusCode;
    }
  };

  return { req, res };
}

// Common consistency validator to automate Task 10 verification
function assertSummaryMatchesDetail(summaryContest, detailData) {
  const detailAttended = detailData.attended.length;
  const detailMissed = detailData.missed.length;
  const detailTotal = detailAttended + detailMissed;

  // Verify Summary.Attended == Detail.Attended
  assert.equal(summaryContest.attendance_count, detailAttended);

  // Verify Summary.Total == Detail.Total
  assert.equal(summaryContest.registration_count, detailTotal);

  // Verify Summary.Missed == Detail.Missed
  const summaryMissed = summaryContest.registration_count - summaryContest.attendance_count;
  assert.equal(summaryMissed, detailMissed);

  // Verify Summary.AttendancePercentage == (Attended / Total) * 100
  const detailRate = detailTotal > 0 ? Math.round((detailAttended / detailTotal) * 100) : 0;
  const summaryRate = summaryContest.registration_count > 0
    ? Math.round((summaryContest.attendance_count / summaryContest.registration_count) * 100)
    : 0;
  assert.equal(summaryRate, detailRate);
}

test('Contest Master Consistency - 0 participants', async () => {
  await db.initializeDatabase();

  // Ensure CSE department exists
  await db.query("INSERT IGNORE INTO departments (name, code) VALUES ('Computer Science', 'CSE')");

  const slug = `test-cons-zero-${Date.now()}`;
  const batch = `batch-zero-${Date.now()}`;

  // Insert Contest
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform)
    VALUES ('Zero Participant Test', ?, 'Weekly', 101, '2026-01-10 14:00:00', 5400, 'RATED', 'LeetCode')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  // Insert 3 active students
  const studentIds = [];
  for (let i = 1; i <= 3; i++) {
    const regNo = `ROLL-ZERO-${i}-${Date.now()}`;
    const insertRes = await db.query(`
      INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
      VALUES (?, ?, 'CSE', 'A', ?, ?, '2025-07-01', '2029-06-30', 'active')
    `, [`Student Zero ${i}`, regNo, `user_zero_${i}_${Date.now()}`, batch]);
    studentIds.push(insertRes.insertId || insertRes[0]?.insertId);
  }

  try {
    // 1. Fetch Contest Master Summary
    const { req: sumReq, res: sumRes } = makeMockReqRes({ platform: 'leetcode' }, { studentId: 'all', batch });
    await contestmasterController.getPlatformAnalytics(sumReq, sumRes);
    assert.equal(sumRes.data.success, true);
    
    const summaryContest = sumRes.data.contests.find(c => c.id === contestId);
    assert.ok(summaryContest);

    // 2. Fetch Expanded Details
    const { req: detReq, res: detRes } = makeMockReqRes({ contestId: slug }, { batch });
    await attendanceController.getContestAttendance(detReq, detRes);
    assert.equal(detRes.data.success, true);

    // Validate
    assertSummaryMatchesDetail(summaryContest, detRes.data);
    assert.equal(summaryContest.attendance_count, 0);
    assert.equal(summaryContest.registration_count, 3); // All 3 eligible missed

  } finally {
    // Clean up
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query(`DELETE FROM Users WHERE academic_batch = ?`, [batch]);
  }
});

test('Contest Master Consistency - Partial attendance', async () => {
  await db.initializeDatabase();

  // Ensure CSE department exists
  await db.query("INSERT IGNORE INTO departments (name, code) VALUES ('Computer Science', 'CSE')");

  const slug = `test-cons-part-${Date.now()}`;
  const batch = `batch-part-${Date.now()}`;

  // Insert Contest
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform)
    VALUES ('Partial Attendance Test', ?, 'Weekly', 102, '2026-01-10 14:00:00', 5400, 'RATED', 'LeetCode')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  // Insert 3 students
  const students = [];
  for (let i = 1; i <= 3; i++) {
    const regNo = `ROLL-PART-${i}-${Date.now()}`;
    const username = `user_part_${i}_${Date.now()}`;
    const insertRes = await db.query(`
      INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
      VALUES (?, ?, 'CSE', 'A', ?, ?, '2025-07-01', '2029-06-30', 'active')
    `, [`Student Part ${i}`, regNo, username, batch]);
    students.push({ id: insertRes.insertId || insertRes[0]?.insertId, username });
  }

  // Student 1: Present via Manual Override PRESENT
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source)
    VALUES (?, ?, 'Partial Attendance Test', ?, '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'MANUAL')
  `, [students[0].id, contestId, slug]);

  // Student 2: Present via ParticipationLogs (Joined)
  await db.query(`
    INSERT INTO ParticipationLogs (user_id, contest_id, join_time, participation_status)
    VALUES (?, ?, '2026-01-10 14:15:00', 'JOINED')
  `, [students[1].id, contestId]);
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source)
    VALUES (?, ?, 'Partial Attendance Test', ?, '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'AUTO')
  `, [students[1].id, contestId, slug]);

  // Student 3: Absent (no logs)

  try {
    // 1. Summary
    const { req: sumReq, res: sumRes } = makeMockReqRes({ platform: 'leetcode' }, { studentId: 'all', batch });
    await contestmasterController.getPlatformAnalytics(sumReq, sumRes);
    const summaryContest = sumRes.data.contests.find(c => c.id === contestId);
    assert.ok(summaryContest);

    // 2. Details
    const { req: detReq, res: detRes } = makeMockReqRes({ contestId: slug }, { batch });
    await attendanceController.getContestAttendance(detReq, detRes);

    // Validate
    assertSummaryMatchesDetail(summaryContest, detRes.data);
    assert.equal(summaryContest.attendance_count, 2); // Student 1 & 2 present
    assert.equal(summaryContest.registration_count, 3); // 3 total eligible

  } finally {
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM ParticipationLogs WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query(`DELETE FROM Users WHERE academic_batch = ?`, [batch]);
  }
});

test('Contest Master Consistency - 100% attendance', async () => {
  await db.initializeDatabase();

  // Ensure CSE department exists
  await db.query("INSERT IGNORE INTO departments (name, code) VALUES ('Computer Science', 'CSE')");

  const slug = `test-cons-full-${Date.now()}`;
  const batch = `batch-full-${Date.now()}`;

  // Insert Contest
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform)
    VALUES ('100% Attendance Test', ?, 'Weekly', 103, '2026-01-10 14:00:00', 5400, 'RATED', 'LeetCode')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  // Insert 2 students
  const students = [];
  for (let i = 1; i <= 2; i++) {
    const regNo = `ROLL-FULL-${i}-${Date.now()}`;
    const username = `user_full_${i}_${Date.now()}`;
    const insertRes = await db.query(`
      INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
      VALUES (?, ?, 'CSE', 'A', ?, ?, '2025-07-01', '2029-06-30', 'active')
    `, [`Student Full ${i}`, regNo, username, batch]);
    students.push({ id: insertRes.insertId || insertRes[0]?.insertId, username });
  }

  // Create LiveContest to match ContestAttendance
  const liveIns = await db.query(`
    INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
    VALUES ('LeetCode', ?, '100% Attendance Test', 'Weekly', '2026-01-10 14:00:00', '2026-01-10 15:30:00', 'Completed')
  `, [slug]);
  const liveContestId = liveIns.insertId || liveIns[0]?.insertId;

  // Student 1: Present via manual override PRESENT
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source)
    VALUES (?, ?, '100% Attendance Test', ?, '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'MANUAL')
  `, [students[0].id, contestId, slug]);

  // Student 2: Present via official leaderboard in ContestAttendance
  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, solved, score, penalty, verified, syncPass)
    VALUES (?, ?, ?, 'Present', 10, 4, 4.00, 300, 1, 4)
  `, [liveContestId, students[1].id, students[1].username]);
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source, \`rank\`, score, problems_solved)
    VALUES (?, ?, '100% Attendance Test', ?, '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'AUTO', 10, 4.00, 4)
  `, [students[1].id, contestId, slug]);

  try {
    // 1. Summary
    const { req: sumReq, res: sumRes } = makeMockReqRes({ platform: 'leetcode' }, { studentId: 'all', batch });
    await contestmasterController.getPlatformAnalytics(sumReq, sumRes);
    const summaryContest = sumRes.data.contests.find(c => c.id === contestId);
    assert.ok(summaryContest);

    // 2. Details
    const { req: detReq, res: detRes } = makeMockReqRes({ contestId: slug }, { batch });
    await attendanceController.getContestAttendance(detReq, detRes);

    // Validate
    assertSummaryMatchesDetail(summaryContest, detRes.data);
    assert.equal(summaryContest.attendance_count, 2);
    assert.equal(summaryContest.registration_count, 2);

  } finally {
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM ContestAttendance WHERE contestId = ?", [liveContestId]);
    await db.query("DELETE FROM LiveContests WHERE id = ?", [liveContestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query(`DELETE FROM Users WHERE academic_batch = ?`, [batch]);
  }
});

test('Contest Master Consistency - Mixed attendance and manual overrides', async () => {
  await db.initializeDatabase();

  // Ensure CSE department exists
  await db.query("INSERT IGNORE INTO departments (name, code) VALUES ('Computer Science', 'CSE')");

  const slug = `test-cons-mix-${Date.now()}`;
  const batch = `batch-mix-${Date.now()}`;

  // Insert Contest
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform)
    VALUES ('Mixed Attendance Test', ?, 'Weekly', 104, '2026-01-10 14:00:00', 5400, 'RATED', 'LeetCode')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  // Insert 4 students
  const students = [];
  for (let i = 1; i <= 4; i++) {
    const regNo = `ROLL-MIX-${i}-${Date.now()}`;
    const username = `user_mix_${i}_${Date.now()}`;
    const insertRes = await db.query(`
      INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
      VALUES (?, ?, 'CSE', 'A', ?, ?, '2025-07-01', '2029-06-30', 'active')
    `, [`Student Mix ${i}`, regNo, username, batch]);
    students.push({ id: insertRes.insertId || insertRes[0]?.insertId, username });
  }

  // Student 1: Override ABSENT (even if sync shows Present)
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source)
    VALUES (?, ?, 'Mixed Attendance Test', ?, '2026-01-10 14:00:00', 'RATED', 'ABSENT', 'MANUAL')
  `, [students[0].id, contestId, slug]);

  // Student 2: Joined via ParticipationLogs (Present)
  await db.query(`
    INSERT INTO ParticipationLogs (user_id, contest_id, join_time, participation_status)
    VALUES (?, ?, '2026-01-10 14:15:00', 'JOINED')
  `, [students[1].id, contestId]);
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source)
    VALUES (?, ?, 'Mixed Attendance Test', ?, '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'AUTO')
  `, [students[1].id, contestId, slug]);

  // Student 3: No records (Absent)
  // Student 4: No records (Absent)

  try {
    // 1. Summary
    const { req: sumReq, res: sumRes } = makeMockReqRes({ platform: 'leetcode' }, { studentId: 'all', batch });
    await contestmasterController.getPlatformAnalytics(sumReq, sumRes);
    const summaryContest = sumRes.data.contests.find(c => c.id === contestId);
    assert.ok(summaryContest);

    // 2. Details
    const { req: detReq, res: detRes } = makeMockReqRes({ contestId: slug }, { batch });
    await attendanceController.getContestAttendance(detReq, detRes);

    // Validate
    assertSummaryMatchesDetail(summaryContest, detRes.data);
    assert.equal(summaryContest.attendance_count, 1); // Only student 2 is present
    assert.equal(summaryContest.registration_count, 4); // 4 eligible

  } finally {
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM ParticipationLogs WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query(`DELETE FROM Users WHERE academic_batch = ?`, [batch]);
  }
});

test('Contest Master Consistency - Historical contests and academic eligibility filters', async () => {
  await db.initializeDatabase();

  // Ensure CSE department exists
  await db.query("INSERT IGNORE INTO departments (name, code) VALUES ('Computer Science', 'CSE')");

  const slug = `test-cons-hist-${Date.now()}`;
  const batch = `batch-hist-${Date.now()}`;

  // Insert Contest on 2026-01-10
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform)
    VALUES ('Historical Eligibility Test', ?, 'Weekly', 105, '2026-01-10 14:00:00', 5400, 'RATED', 'LeetCode')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  // Student 1: Eligible during contest (Academic period: 2025-07-01 to 2029-06-30)
  const regNo1 = `ROLL-HIST-1-${Date.now()}`;
  const insertRes1 = await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Student Eligible', ?, 'CSE', 'A', ?, ?, '2025-07-01', '2029-06-30', 'active')
  `, [regNo1, `user_hist_1_${Date.now()}`, batch]);
  const idEligible = insertRes1.insertId || insertRes1[0]?.insertId;

  // Student 2: NOT Eligible during contest (Academic period starts *after* the contest: 2026-07-01)
  const regNo2 = `ROLL-HIST-2-${Date.now()}`;
  const insertRes2 = await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Student Ineligible', ?, 'CSE', 'A', ?, ?, '2026-07-01', '2030-06-30', 'active')
  `, [regNo2, `user_hist_2_${Date.now()}`, batch]);
  const idIneligible = insertRes2.insertId || insertRes2[0]?.insertId;

  // Even if Student 2 has a participation log (legacy/error data), they should be excluded!
  await db.query(`
    INSERT INTO ParticipationLogs (user_id, contest_id, join_time, participation_status)
    VALUES (?, ?, '2026-01-10 14:10:00', 'JOINED')
  `, [idIneligible, contestId]);

  try {
    // 1. Summary
    const { req: sumReq, res: sumRes } = makeMockReqRes({ platform: 'leetcode' }, { studentId: 'all', batch });
    await contestmasterController.getPlatformAnalytics(sumReq, sumRes);
    const summaryContest = sumRes.data.contests.find(c => c.id === contestId);
    assert.ok(summaryContest);

    // 2. Details
    const { req: detReq, res: detRes } = makeMockReqRes({ contestId: slug }, { batch });
    await attendanceController.getContestAttendance(detReq, detRes);

    // Validate
    assertSummaryMatchesDetail(summaryContest, detRes.data);
    assert.equal(summaryContest.registration_count, 1); // Only 1 student eligible
    assert.equal(summaryContest.attendance_count, 0); // Student 1 is absent

    // Verify detail list doesn't contain student 2
    const foundIneligible = detRes.data.data.some(s => s.student_id === idIneligible);
    assert.equal(foundIneligible, false);

  } finally {
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Registrations WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM ParticipationLogs WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query(`DELETE FROM Users WHERE academic_batch = ?`, [batch]);
  }
});

test('Contest Master Canonical Redesign - Validations, Tie Ranks, and Severity Handling', async () => {
  await db.initializeDatabase();
  await db.query("INSERT IGNORE INTO departments (name, code) VALUES ('Computer Science', 'CSE')");

  const slug = `test-canonical-redesign-${Date.now()}`;
  const batch = `batch-canonical-${Date.now()}`;

  // Insert Contest with total_problems = 4
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, total_problems, contest_status, platform)
    VALUES ('Canonical Redesign Test', ?, 'Weekly', 108, '2026-01-10 14:00:00', 5400, 4, 'RATED', 'LeetCode')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  // Insert 6 students
  const students = [];
  for (let i = 1; i <= 6; i++) {
    const regNo = `ROLL-CAN-${i}-${Date.now()}`;
    const username = `user_can_${i}_${Date.now()}`;
    const insertRes = await db.query(`
      INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
      VALUES (?, ?, 'CSE', 'A', ?, ?, '2025-07-01', '2029-06-30', 'active')
    `, [`Student Can ${i}`, regNo, username, batch]);
    students.push({ id: insertRes.insertId || insertRes[0]?.insertId, username });
  }

  // Set up mock LiveContests so ContestAttendance join works
  await db.query(`
    INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
    VALUES ('LeetCode', ?, 'Canonical Redesign Test', 'Weekly', '2026-01-10 14:00:00', '2026-01-10 15:30:00', 'Completed')
  `, [slug]);
  const [liveContestRow] = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
  const liveContestId = liveContestRow.id;

  // Mock mapped participants in ContestAttendance and standings in ContestParticipants

  // Student 1: Normal PRESENT student (solved 2, score 7, rank 100)
  await db.query(`
    INSERT INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, page_number)
    VALUES (?, ?, 100, 7.00, 2, 500, 1)
  `, [slug, students[0].username]);
  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, solved, score, penalty)
    VALUES (?, ?, ?, 'Present', 100, 2, 7.00, 500)
  `, [liveContestId, students[0].id, students[0].username]);
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source, \`rank\`, score, problems_solved)
    VALUES (?, ?, 'Canonical Redesign Test', ?, '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'AUTO', 100, 7.00, 2)
  `, [students[0].id, contestId, slug]);

  // Student 2: Normal ABSENT student (no participation/standings)

  // Student 3: Corrupted - negative score (-5.00) -> Should be skipped!
  await db.query(`
    INSERT INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, page_number)
    VALUES (?, ?, 150, -5.00, 1, 600, 1)
  `, [slug, students[2].username]);
  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, solved, score, penalty)
    VALUES (?, ?, ?, 'Present', 150, 1, -5.00, 600)
  `, [liveContestId, students[2].id, students[2].username]);
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source, \`rank\`, score, problems_solved)
    VALUES (?, ?, 'Canonical Redesign Test', ?, '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'AUTO', 150, -5.00, 1)
  `, [students[2].id, contestId, slug]);

  // Student 4: Corrupted - problems solved > total (5 > 4) -> Should be skipped!
  await db.query(`
    INSERT INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, page_number)
    VALUES (?, ?, 200, 12.00, 5, 800, 1)
  `, [slug, students[3].username]);
  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, solved, score, penalty)
    VALUES (?, ?, ?, 'Present', 200, 5, 12.00, 800)
  `, [liveContestId, students[3].id, students[3].username]);
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source, \`rank\`, score, problems_solved)
    VALUES (?, ?, 'Canonical Redesign Test', ?, '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'AUTO', 200, 12.00, 5)
  `, [students[3].id, contestId, slug]);

  // Student 5: Duplicate Rank Tie Rule Valid case (rank 100, score 7.00, finish_time 500) -> Allowed!
  await db.query(`
    INSERT INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, page_number)
    VALUES (?, ?, 100, 7.00, 2, 500, 1)
  `, [slug, students[4].username]);
  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, solved, score, penalty)
    VALUES (?, ?, ?, 'Present', 100, 2, 7.00, 500)
  `, [liveContestId, students[4].id, students[4].username]);
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source, \`rank\`, score, problems_solved)
    VALUES (?, ?, 'Canonical Redesign Test', ?, '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'AUTO', 100, 7.00, 2)
  `, [students[4].id, contestId, slug]);

  // Student 6: Duplicate Rank Tie Rule IN-VALID case (rank 100, score 8.00, finish_time 700) -> Should be skipped!
  await db.query(`
    INSERT INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, page_number)
    VALUES (?, ?, 100, 8.00, 3, 700, 1)
  `, [slug, students[5].username]);
  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, solved, score, penalty)
    VALUES (?, ?, ?, 'Present', 100, 3, 8.00, 700)
  `, [liveContestId, students[5].id, students[5].username]);
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source, \`rank\`, score, problems_solved)
    VALUES (?, ?, 'Canonical Redesign Test', ?, '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'AUTO', 100, 8.00, 3)
  `, [students[5].id, contestId, slug]);

  try {
    // 1. Fetch via canonical resolver directly
    const result = await attendanceService.resolveCanonicalContestParticipants(contestId, { batch });
    
    // Assert summary matches details exactly
    const presentCount = result.present.length;
    const absentCount = result.absent.length;
    assert.equal(result.summary.registered, presentCount + absentCount);
    assert.equal(result.summary.attended, presentCount);

    // Students 1, 3, 4, 5, 6 resolve to PRESENT (3, 4, 6 had invalid metrics but remain present)
    assert.equal(presentCount, 5);
    // Student 2 (Normal ABSENT) resolved
    assert.equal(absentCount, 1);

    // Corrupted students (Student 3, Student 4, Student 6) must remain in lists but have null metrics
    assert.equal(result.validationStatus, 'INVALID_METRICS');
    assert.ok(result.validationIssues.length > 0);

    const p3 = result.present.find(p => p.student_id === students[2].id);
    assert.ok(p3);
    assert.equal(p3.contest_rank, null);
    assert.equal(p3.problemsSolved, null);
    assert.equal(p3.contestScore, null);
    assert.equal(p3.finishTime, null);

    const p4 = result.present.find(p => p.student_id === students[3].id);
    assert.ok(p4);
    assert.equal(p4.contest_rank, null);
    assert.equal(p4.problemsSolved, null);
    assert.equal(p4.contestScore, null);
    assert.equal(p4.finishTime, null);

    const p6 = result.present.find(p => p.student_id === students[5].id);
    assert.ok(p6);
    assert.equal(p6.contest_rank, null);
    assert.equal(p6.problemsSolved, null);
    assert.equal(p6.contestScore, null);
    assert.equal(p6.finishTime, null);

    const p1 = result.present.find(p => p.student_id === students[0].id);
    assert.ok(p1);
    assert.equal(p1.contest_rank, 100);
    assert.equal(p1.problemsSolved, 2);
    assert.equal(parseFloat(p1.contestScore), 7.00);
    assert.equal(p1.finishTime, 500);

    // 2. Fetch via controller wrapper and check contract
    const { req: sumReq, res: sumRes } = makeMockReqRes({ platform: 'leetcode' }, { studentId: 'all', batch });
    await contestmasterController.getPlatformAnalytics(sumReq, sumRes);
    assert.equal(sumRes.data.success, true);
    
    const summaryContest = sumRes.data.contests.find(c => c.id === contestId);
    assert.ok(summaryContest);
    assert.equal(summaryContest.validationStatus, 'INVALID_METRICS');
    assert.equal(summaryContest.registration_count, 6); // all 6 students
    assert.equal(summaryContest.attendance_count, 5);

  } finally {
    await db.query("DELETE FROM ContestParticipants WHERE contest_slug = ?", [slug]);
    await db.query("DELETE FROM ContestAttendance WHERE contestId = ?", [liveContestId]);
    await db.query("DELETE FROM LiveContests WHERE id = ?", [liveContestId]);
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query(`DELETE FROM Users WHERE academic_batch = ?`, [batch]);
  }
});

test('Contest Master Canonical Redesign - 6-Problem Scaling', async () => {
  await db.initializeDatabase();
  await db.query("INSERT IGNORE INTO departments (name, code) VALUES ('Computer Science', 'CSE')");

  const slug = `test-six-problems-${Date.now()}`;
  const batch = `batch-six-${Date.now()}`;

  // Insert CodeChef Contest with total_problems = 6
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, total_problems, contest_status, platform)
    VALUES ('CodeChef 6 Problems Test', ?, 'Weekly', 109, '2026-01-10 14:00:00', 5400, 6, 'RATED', 'CodeChef')
  `, [slug]);

  const [contestRow] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug]);
  const contestId = contestRow.contest_id;

  // Insert student
  const regNo = `ROLL-SIX-${Date.now()}`;
  const username = `user_six_${Date.now()}`;
  const insertRes = await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, codechef_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Student Six', ?, 'CSE', 'A', ?, ?, ?, '2025-07-01', '2029-06-30', 'active')
  `, [regNo, `lc_${username}`, username, batch]);
  const studentId = insertRes.insertId || insertRes[0]?.insertId;

  // Set up mock LiveContests so ContestAttendance join works
  await db.query(`
    INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
    VALUES ('CodeChef', ?, 'CodeChef 6 Problems Test', 'Weekly', '2026-01-10 14:00:00', '2026-01-10 15:30:00', 'Completed')
  `, [slug]);
  const [liveContestRow] = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
  const liveContestId = liveContestRow.id;

  // Mock mapped participant with solved = 5 problems -> should pass because total is 6!
  await db.query(`
    INSERT INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, page_number)
    VALUES (?, ?, 10, 500, 5, 400, 1)
  `, [slug, username]);
  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, solved, score, penalty)
    VALUES (?, ?, ?, 'Present', 10, 5, 500, 400)
  `, [liveContestId, studentId, username]);
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source, \`rank\`, score, problems_solved)
    VALUES (?, ?, 'CodeChef 6 Problems Test', ?, '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'AUTO', 10, 500.00, 5)
  `, [studentId, contestId, slug]);

  try {
    const result = await attendanceService.resolveCanonicalContestParticipants(contestId, { batch });
    assert.equal(result.validationStatus, 'PASSED');
    assert.equal(result.present.length, 1);
    assert.equal(result.present[0].problemsSolved, 5);
    assert.equal(result.present[0].totalProblems, 6);

  } finally {
    await db.query("DELETE FROM ContestParticipants WHERE contest_slug = ?", [slug]);
    await db.query("DELETE FROM ContestAttendance WHERE contestId = ?", [liveContestId]);
    await db.query("DELETE FROM LiveContests WHERE id = ?", [liveContestId]);
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId]);
    await db.query(`DELETE FROM Users WHERE academic_batch = ?`, [batch]);
  }
});

test('Contest Master Codeforces Dashboard Analytics and UI Logic', async () => {
  await db.initializeDatabase();
  await db.query("INSERT IGNORE INTO departments (name, code) VALUES ('Computer Science', 'CSE')");

  const batch = `batch-cf-${Date.now()}`;
  
  // 1. Create a few students with future academic periods
  const students = [];
  for (let i = 1; i <= 3; i++) {
    const regNo = `ROLL-CF-${i}-${Date.now()}`;
    const username = `cf_user_${i}_${Date.now()}`;
    const insertRes = await db.query(`
      INSERT INTO Users (name, roll_no, department, section, leetcode_username, codechef_username, codeforces_username, academic_batch, academic_start_date, academic_end_date, status)
      VALUES (?, ?, 'CSE', 'A', ?, ?, ?, ?, '2030-07-01', '2034-06-30', 'active')
    `, [`CF Student ${i}`, regNo, `lc_${username}`, `cc_${username}`, username, batch]);
    students.push({ id: insertRes.insertId || insertRes[0]?.insertId, username });
  }

  // 2. Validate classifyCodeforcesType helper
  const { classifyCodeforcesType } = attendanceService;
  assert.equal(classifyCodeforcesType('Codeforces Round 1085 (Div.1 + Div.2)'), 'div1+div2');
  assert.equal(classifyCodeforcesType('Codeforces Round 100 (Div. 1)'), 'div1');
  assert.equal(classifyCodeforcesType('Codeforces Round 200 (Div. 2)'), 'div2');
  assert.equal(classifyCodeforcesType('Codeforces Round 300 (Div. 3)'), 'div3');
  assert.equal(classifyCodeforcesType('Codeforces Round 400 (Div. 4)'), 'div4');
  assert.equal(classifyCodeforcesType('Educational Codeforces Round 160'), 'educational');
  assert.equal(classifyCodeforcesType('Codeforces Global Round 25'), 'global');

  // 3. Test zero contests
  const zeroAnalytics = await attendanceService.getPlatformAnalytics('codeforces', 'all', { batch });
  assert.equal(zeroAnalytics.metrics.eligible, 0);
  assert.equal(zeroAnalytics.metrics.attended, 0);
  assert.equal(zeroAnalytics.metrics.rate, 0.0);

  // 4. Seed contest: Div.1 + Div.2 in the future
  const slug1 = `cf-slug-1-${Date.now()}`;
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, total_problems, contest_status, platform)
    VALUES ('Codeforces Round 1085 (Div.1 + Div.2)', ?, 'Weekly', 1085, '2031-01-10 14:00:00', 7200, 6, 'RATED', 'Codeforces')
  `, [slug1]);
  const [cRow1] = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [slug1]);
  const contestId1 = cRow1.contest_id;

  // Student 1 attended, Student 2 & 3 did not
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source, \`rank\`, score, problems_solved)
    VALUES (?, ?, 'Codeforces Round 1085 (Div.1 + Div.2)', ?, '2031-01-10 14:00:00', 'RATED', 'PRESENT', 'AUTO', 50, 4.00, 4)
  `, [students[0].id, contestId1, slug1]);

  try {
    const oneContestAnalytics = await attendanceService.getPlatformAnalytics('codeforces', 'all', { batch });
    // Eligible = 1 contest. Attended rate = 1 / 3 = 33.3%
    assert.equal(oneContestAnalytics.metrics.eligible, 1);
    assert.equal(oneContestAnalytics.metrics.rate, 33.3);
    assert.equal(oneContestAnalytics.metrics.attended, 0.33); // Average contests attended per student
  } finally {
    await db.query("DELETE FROM AttendanceRecords WHERE contest_id = ?", [contestId1]);
    await db.query("DELETE FROM Contests WHERE contest_id = ?", [contestId1]);
    await db.query(`DELETE FROM Users WHERE academic_batch = ?`, [batch]);
  }
});

test('Contest Records Type Mapping and Single Source of Truth', async () => {
  await db.initializeDatabase();

  const slugDiv12 = `cf-slug-div12-${Date.now()}`;
  const slugDiv1 = `cf-slug-div1-${Date.now()}`;
  const slugDiv2 = `cf-slug-div2-${Date.now()}`;
  const slugEdu = `cf-slug-edu-${Date.now()}`;
  const slugGlobal = `cf-slug-global-${Date.now()}`;

  // Insert contests of different types on Codeforces
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform)
    VALUES 
      ('Codeforces Round 1085 (Div.1 + Div.2)', ?, 'Weekly', 1085, '2026-01-10 14:00:00', 7200, 'RATED', 'Codeforces'),
      ('Codeforces Round 100 (Div. 1)', ?, 'Weekly', 100, '2026-01-11 14:00:00', 7200, 'RATED', 'Codeforces'),
      ('Codeforces Round 200 (Div. 2)', ?, 'Weekly', 200, '2026-01-12 14:00:00', 7200, 'RATED', 'Codeforces'),
      ('Educational Codeforces Round 160', ?, 'Weekly', 160, '2026-01-13 14:00:00', 7200, 'RATED', 'Codeforces'),
      ('Codeforces Global Round 25', ?, 'Weekly', 25, '2026-01-14 14:00:00', 7200, 'RATED', 'Codeforces')
  `, [slugDiv12, slugDiv1, slugDiv2, slugEdu, slugGlobal]);

  try {
    const contestController = require('../controllers/contestController');
    let responseData = null;
    const mockReq = { query: {} };
    const mockRes = {
      json: (data) => {
        responseData = data;
        return mockRes;
      },
      status: (code) => mockRes
    };

    await contestController.getContests(mockReq, mockRes);
    
    assert.ok(responseData && responseData.success);
    const list = responseData.data;

    const div12Contest = list.find(c => c.contest_id === slugDiv12);
    const div1Contest = list.find(c => c.contest_id === slugDiv1);
    const div2Contest = list.find(c => c.contest_id === slugDiv2);
    const eduContest = list.find(c => c.contest_id === slugEdu);
    const globalContest = list.find(c => c.contest_id === slugGlobal);

    assert.equal(div12Contest.type, 'div1+div2');
    assert.equal(div1Contest.type, 'div1');
    assert.equal(div2Contest.type, 'div2');
    assert.equal(eduContest.type, 'educational');
    assert.equal(globalContest.type, 'global');

    // Verify consistency with analytics classification helper (single source of truth)
    const { classifyCodeforcesType } = require('../services/attendanceService');
    assert.equal(div12Contest.type, classifyCodeforcesType('Codeforces Round 1085 (Div.1 + Div.2)'));
    assert.equal(div1Contest.type, classifyCodeforcesType('Codeforces Round 100 (Div. 1)'));
    assert.equal(div2Contest.type, classifyCodeforcesType('Codeforces Round 200 (Div. 2)'));
    assert.equal(eduContest.type, classifyCodeforcesType('Educational Codeforces Round 160'));
    assert.equal(globalContest.type, classifyCodeforcesType('Codeforces Global Round 25'));

  } finally {
    await db.query("DELETE FROM Contests WHERE slug IN (?, ?, ?, ?, ?)", [slugDiv12, slugDiv1, slugDiv2, slugEdu, slugGlobal]);
  }
});

after(async () => {
  await db.closePool();
});
