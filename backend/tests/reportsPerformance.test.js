const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const attendanceService = require('../services/attendanceService');
const reportController = require('../controllers/reportController');

test('Reports & Analytics - Student Performance Page Multi-Platform Suite', async (t) => {
  await db.initializeDatabase();

  // Create department to satisfy foreign key constraints
  await db.query("INSERT IGNORE INTO Departments (name, code) VALUES ('Department of Testing', 'DEPT')");

  const batch = `batch-report-${Date.now()}`;
  const dept = 'DEPT';
  const sec = 'A';

  // Seed test users
  // Student 1: LeetCode + Codeforces + CodeChef
  // Student 2: LeetCode only
  // Student 3: LeetCode + Codeforces
  // Student 4: LeetCode + CodeChef
  // Student 5: LeetCode only (representing no other platform handles)
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, academic_batch, status, leetcode_username, codeforces_username, codechef_username, academic_start_date, academic_end_date)
    VALUES 
      ('Student One', 'R101', ?, ?, ?, 'active', 'lc_one', 'cf_one', 'cc_one', '2020-01-01', '2030-01-01'),
      ('Student Two', 'R102', ?, ?, ?, 'active', 'lc_two', NULL, NULL, '2020-01-01', '2030-01-01'),
      ('Student Three', 'R103', ?, ?, ?, 'active', 'lc_three', 'cf_three', NULL, '2020-01-01', '2030-01-01'),
      ('Student Four', 'R104', ?, ?, ?, 'active', 'lc_four', NULL, 'cc_four', '2020-01-01', '2030-01-01'),
      ('Student Five', 'R105', ?, ?, ?, 'active', 'lc_five', NULL, NULL, '2020-01-01', '2030-01-01')
  `, [dept, sec, batch, dept, sec, batch, dept, sec, batch, dept, sec, batch, dept, sec, batch]);

  const students = await db.query("SELECT id, roll_no FROM Users WHERE academic_batch = ?", [batch]);
  const s1 = students.find(s => s.roll_no === 'R101');
  const s2 = students.find(s => s.roll_no === 'R102');
  const s3 = students.find(s => s.roll_no === 'R103');
  const s4 = students.find(s => s.roll_no === 'R104');
  const s5 = students.find(s => s.roll_no === 'R105');

  // Seed profiles
  await db.query(`
    INSERT INTO LeetCodeProfiles (user_id, current_rating, highest_rating, global_ranking, problems_solved)
    VALUES 
      (?, 1700, 1850, 12000, 250),
      (?, 1450, 1500, 45000, 120)
  `, [s1.id, s2.id]);

  await db.query(`
    INSERT INTO CodeforcesProfiles (user_id, current_rating, highest_rating, \`rank\`, max_rank)
    VALUES 
      (?, 1600, 1750, 'specialist', 'expert'),
      (?, 1300, 1400, 'pupil', 'pupil')
  `, [s1.id, s3.id]);

  await db.query(`
    INSERT INTO CodeChefProfiles (user_id, current_rating, highest_rating, stars)
    VALUES 
      (?, 1800, 1950, '4★'),
      (?, 1250, 1350, '2★')
  `, [s1.id, s4.id]);

  // Seed contests
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform)
    VALUES 
      ('LC Rated 1', 'lc-rated-1', 'Weekly', 1, '2026-01-10 14:00:00', 5400, 'RATED', 'LeetCode'),
      ('CF Rated 1', 'cf-rated-1', 'Weekly', 2, '2026-01-11 14:00:00', 7200, 'RATED', 'Codeforces'),
      ('CC Rated 1', 'cc-rated-1', 'Weekly', 3, '2026-01-12 14:00:00', 10800, 'RATED', 'CodeChef'),
      ('LC Unrated 1', 'lc-unrated-1', 'Weekly', 4, '2026-01-13 14:00:00', 5400, 'UNRATED', 'LeetCode')
  `);

  const contests = await db.query("SELECT contest_id, slug FROM Contests WHERE slug IN ('lc-rated-1', 'cf-rated-1', 'cc-rated-1', 'lc-unrated-1')");
  const cLC = contests.find(c => c.slug === 'lc-rated-1');
  const cCF = contests.find(c => c.slug === 'cf-rated-1');
  const cCC = contests.find(c => c.slug === 'cc-rated-1');
  const cUnrated = contests.find(c => c.slug === 'lc-unrated-1');

  // Seed attendance records
  // S1 present in LC Rated 1 (present_count = 1, rated = 1)
  // S1 absent in CF Rated 1 (present_count = 1, rated = 2, attendance = 50%)
  // S1 present in CC Rated 1 (present_count = 2, rated = 3, attendance = 67%)
  // S1 present in LC Unrated 1 (unrated_contests = 1)
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source)
    VALUES 
      (?, ?, 'LC Rated 1', 'lc-rated-1', '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'AUTO'),
      (?, ?, 'CF Rated 1', 'cf-rated-1', '2026-01-11 14:00:00', 'RATED', 'ABSENT', 'AUTO'),
      (?, ?, 'CC Rated 1', 'cc-rated-1', '2026-01-12 14:00:00', 'RATED', 'PRESENT', 'AUTO'),
      (?, ?, 'LC Unrated 1', 'lc-unrated-1', '2026-01-13 14:00:00', 'UNRATED', 'PRESENT', 'AUTO')
  `, [s1.id, cLC.contest_id, s1.id, cCF.contest_id, s1.id, cCC.contest_id, s1.id, cUnrated.contest_id]);

  // S2 present in LC Rated 1
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source)
    VALUES (?, ?, 'LC Rated 1', 'lc-rated-1', '2026-01-10 14:00:00', 'RATED', 'PRESENT', 'AUTO')
  `, [s2.id, cLC.contest_id]);

  // S3 present in CF Rated 1
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source)
    VALUES (?, ?, 'CF Rated 1', 'cf-rated-1', '2026-01-11 14:00:00', 'RATED', 'PRESENT', 'AUTO')
  `, [s3.id, cCF.contest_id]);

  // S4 present in CC Rated 1
  await db.query(`
    INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source)
    VALUES (?, ?, 'CC Rated 1', 'cc-rated-1', '2026-01-12 14:00:00', 'RATED', 'PRESENT', 'AUTO')
  `, [s4.id, cCC.contest_id]);

  await t.test('1. LeetCode report filters & mappings correctly', async () => {
    const data = await attendanceService.getBatchAttendanceSummary({ academicBatch: batch, platform: 'leetcode' });
    
    // All 5 students have LeetCode handles
    assert.equal(data.length, 5);
    const s1Row = data.find(r => r.register_number === 'R101');
    const s2Row = data.find(r => r.register_number === 'R102');

    assert.ok(s1Row);
    assert.ok(s2Row);

    assert.equal(s1Row.platform, 'leetcode');
    assert.equal(s1Row.username, 'lc_one');
    assert.equal(s1Row.current_rating, 1700);
    assert.equal(s1Row.best_rating, 1850);
    assert.equal(s1Row.rank_history, 12000);
    assert.equal(s1Row.rated_contests, 1); // Only LC Rated 1 counts
    assert.equal(s1Row.present_count, 1);
    assert.equal(s1Row.attendance_percentage, 100);
    assert.equal(s1Row.unrated_contests, 1);

    assert.equal(s2Row.current_rating, 1450);
    assert.equal(s2Row.best_rating, 1500);
    assert.equal(s2Row.attendance_percentage, 100);
  });

  await t.test('2. Codeforces report filters & mappings correctly', async () => {
    const data = await attendanceService.getBatchAttendanceSummary({ academicBatch: batch, platform: 'codeforces' });
    
    // S1 and S3 have Codeforces profiles
    assert.equal(data.length, 2);
    const s1Row = data.find(r => r.register_number === 'R101');
    const s3Row = data.find(r => r.register_number === 'R103');

    assert.ok(s1Row);
    assert.ok(s3Row);

    assert.equal(s1Row.platform, 'codeforces');
    assert.equal(s1Row.username, 'cf_one');
    assert.equal(s1Row.current_rating, 1600);
    assert.equal(s1Row.best_rating, 1750);
    assert.equal(s1Row.cf_rank, 'specialist');
    assert.equal(s1Row.cf_max_rank, 'expert');
    assert.equal(s1Row.rated_contests, 1); // S1 is absent in CF Rated 1
    assert.equal(s1Row.present_count, 0);
    assert.equal(s1Row.attendance_percentage, 0);

    assert.equal(s3Row.current_rating, 1300);
    assert.equal(s3Row.best_rating, 1400);
    assert.equal(s3Row.cf_rank, 'pupil');
    assert.equal(s3Row.cf_max_rank, 'pupil');
    assert.equal(s3Row.attendance_percentage, 100);
  });

  await t.test('3. CodeChef report filters & mappings correctly', async () => {
    const data = await attendanceService.getBatchAttendanceSummary({ academicBatch: batch, platform: 'codechef' });
    
    // S1 and S4 have CodeChef profiles
    assert.equal(data.length, 2);
    const s1Row = data.find(r => r.register_number === 'R101');
    const s4Row = data.find(r => r.register_number === 'R104');

    assert.ok(s1Row);
    assert.ok(s4Row);

    assert.equal(s1Row.platform, 'codechef');
    assert.equal(s1Row.username, 'cc_one');
    assert.equal(s1Row.current_rating, 1800);
    assert.equal(s1Row.best_rating, 1950);
    assert.equal(s1Row.cc_stars, '4★');
    assert.equal(s1Row.rated_contests, 1);
    assert.equal(s1Row.present_count, 1);
    assert.equal(s1Row.attendance_percentage, 100);

    assert.equal(s4Row.current_rating, 1250);
    assert.equal(s4Row.best_rating, 1350);
    assert.equal(s4Row.cc_stars, '2★');
    assert.equal(s4Row.attendance_percentage, 100);
  });

  await t.test('4. All platforms returns one row per profile + placeholders', async () => {
    const data = await attendanceService.getBatchAttendanceSummary({ academicBatch: batch, platform: 'all' });
    
    // S1: 3 rows (LC, CF, CC)
    // S2: 1 row (LC)
    // S3: 2 rows (LC, CF)
    // S4: 2 rows (LC, CC)
    // S5: 1 row (LC)
    // Total = 9 rows
    assert.equal(data.length, 9);

    const s1Rows = data.filter(r => r.register_number === 'R101');
    assert.equal(s1Rows.length, 3);
  });

  await t.test('5. Empty results handles gracefully', async () => {
    // Non-existent section
    const data = await attendanceService.getBatchAttendanceSummary({ academicBatch: batch, section: 'Z' });
    assert.equal(data.length, 0);
  });

  await t.test('6. Date range filtering works', async () => {
    // LC Rated 1 is 2026-01-10. If we search from 2026-01-12:
    const data = await attendanceService.getBatchAttendanceSummary({ 
      academicBatch: batch, 
      platform: 'leetcode',
      startDate: '2026-01-12' 
    });
    const s1Row = data.find(r => r.register_number === 'R101');
    assert.ok(s1Row);
    assert.equal(s1Row.rated_contests, 0); // LC Rated 1 was on Jan 10
  });

  await t.test('7. Controller handles getStudentsReport correctly', async () => {
    let responseData = null;
    const mockReq = {
      query: {
        academicYear: batch,
        platform: 'codeforces'
      }
    };
    const mockRes = {
      json: (data) => {
        responseData = data;
        return mockRes;
      },
      status: (code) => mockRes
    };

    await reportController.getStudentsReport(mockReq, mockRes);
    assert.ok(responseData);
    assert.equal(responseData.success, true);
    assert.equal(responseData.count, 2);
  });

  // Clean up
  await db.query("DELETE FROM AttendanceRecords WHERE contest_id IN (SELECT contest_id FROM Contests WHERE slug LIKE '%-rated-1' OR slug LIKE '%-unrated-1')");
  await db.query("DELETE FROM Contests WHERE slug LIKE '%-rated-1' OR slug LIKE '%-unrated-1'");
  await db.query("DELETE FROM LeetCodeProfiles WHERE user_id IN (SELECT id FROM Users WHERE academic_batch = ?)", [batch]);
  await db.query("DELETE FROM CodeforcesProfiles WHERE user_id IN (SELECT id FROM Users WHERE academic_batch = ?)", [batch]);
  await db.query("DELETE FROM CodeChefProfiles WHERE user_id IN (SELECT id FROM Users WHERE academic_batch = ?)", [batch]);
  await db.query("DELETE FROM Users WHERE academic_batch = ?", [batch]);
  await db.query("DELETE FROM Departments WHERE code = 'DEPT'");
});

after(async () => {
  const pool = db.getPool();
  if (pool) {
    await pool.end();
  }
});
