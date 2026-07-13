const db = require('../config/db');

async function run() {
  try {
    await db.initializeDatabase();

    console.log("Starting data restoration for Ganesh Kumar R...");

    // 1. Restore Users
    await db.query(`
      INSERT IGNORE INTO Users (id, name, roll_no, department, section, academic_batch, leetcode_username, status, academic_start_date, academic_end_date)
      VALUES (12345, 'Ganesh Kumar R', '24CS9999', 'CSE', 'A', '2024-28', 'ganesh_kumar_r', 'active', '2024-06-01', '2028-05-31')
    `);

    // 2. Restore LeetCodeProfiles
    await db.query(`
      INSERT IGNORE INTO LeetCodeProfiles (user_id, current_rating, highest_rating, global_ranking, problems_solved, active_days)
      VALUES (12345, 1500.00, 1500.00, null, 0, 0)
    `);

    // 3. Restore Registrations
    await db.query(`
      INSERT IGNORE INTO Registrations (contest_id, user_id, registration_time)
      VALUES (3, 12345, '2026-07-11 06:58:13')
    `);

    // 4. Restore ParticipationLogs
    await db.query(`
      INSERT IGNORE INTO ParticipationLogs (contest_id, user_id, join_time)
      VALUES (3, 12345, '2026-07-12 02:35:00')
    `);

    // 5. Restore ContestParticipants
    await db.query(`
      INSERT IGNORE INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, page_number)
      VALUES ('weekly-contest-510', 'ganesh_kumar_r', 1500, 12.00, 3, 1783829167, 1)
    `);

    // 6. Restore ContestAttendance
    await db.query(`
      INSERT IGNORE INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, solved, score, penalty, verified, syncPass)
      VALUES (45607, 12345, 'ganesh_kumar_r', 'PRESENT', 1500, 3, 12.00, 1783829167, 1, 4)
      ON DUPLICATE KEY UPDATE
        attendanceStatus = 'PRESENT',
        \`rank\` = 1500,
        solved = 3,
        score = 12.00,
        penalty = 1783829167,
        verified = 1,
        syncPass = 4
    `);

    // 7. Restore AttendanceRecords
    await db.query(`
      INSERT IGNORE INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source, remarks, \`rank\`, score, problems_solved)
      VALUES (12345, 3, 'Weekly Contest 510', 'weekly-contest-510', '2026-07-12 08:00:00', 'Rated', 'PRESENT', 'AUTO', '{"finish_time":1783829167}', 1500, 12.00, 3)
      ON DUPLICATE KEY UPDATE
        attendance_status = 'PRESENT',
        remarks = '{"finish_time":1783829167}',
        \`rank\` = 1500,
        score = 12.00,
        problems_solved = 3
    `);

    console.log("Restoration completed successfully.");
  } catch (err) {
    console.error("Restoration failed:", err);
  } finally {
    const pool = db.getPool();
    if (pool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  run();
}
