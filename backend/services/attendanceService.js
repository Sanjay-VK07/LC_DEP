/**
 * AttendanceService
 * =================
 * Centralized attendance logic — the single source of truth for attendance status.
 *
 * Attendance eligibility rules:
 * 1. Student account must be active
 * 2. Contest must be registered in the Contests table (status != Cancelled)
 * 3. Contest must have ended (start_time + duration <= now)
 * 4. Student must be within academic period (contest date >= academic_start_date AND <= academic_end_date)
 *
 * Attendance sources:
 * - AUTO: derived from ParticipationLogs
 * - MANUAL: set by faculty override
 *
 * All controllers must consume this service for attendance calculations.
 */

const db = require('../config/db');

// Helper — parse date without timezone shift
function parseDateOnly(dateInput) {
  if (!dateInput) return null;
  let dateStr;
  if (dateInput instanceof Date) {
    const y = dateInput.getFullYear();
    const m = String(dateInput.getMonth() + 1).padStart(2, '0');
    const d = String(dateInput.getDate()).padStart(2, '0');
    dateStr = `${y}-${m}-${d}`;
  } else if (typeof dateInput === 'string') {
    dateStr = dateInput.substring(0, 10);
  } else {
    const dt = new Date(dateInput);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    dateStr = `${y}-${m}-${d}`;
  }
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d, 0, 0, 0, 0);
}

/**
 * Determine attendance status for a student-contest pair.
 * @param {object} student - { academic_start_date, academic_end_date }
 * @param {object} contest - { start_time, duration, contest_status }
 * @param {boolean} participated - true if ParticipationLogs entry exists
 * @param {string|null} attendanceSource - 'AUTO' | 'MANUAL' | null
 * @param {string|null} storedStatus - PRESENT | ABSENT (manual override)
 * @returns {string} - 'PRESENT' | 'ABSENT' | 'NOT_APPLICABLE' | 'ONGOING' | 'UNRATED'
 */
function determineAttendanceStatus(student, contest, participated, attendanceSource, storedStatus) {
  const now = new Date();
  const contestStart = new Date(contest.start_time);
  const durationMs = (Number(contest.duration) || 5400) * 1000;
  const contestEnd = new Date(contestStart.getTime() + durationMs);

  // Is the contest still ongoing?
  if (contestStart <= now && contestEnd > now) {
    return 'ONGOING';
  }

  // Is the contest unrated/cancelled?
  const status = (contest.contest_status || '').toLowerCase();
  if (status === 'unrated' || status === 'cancelled') {
    return 'UNRATED';
  }

  // Is the student eligible (within academic period)?
  const contestDate = parseDateOnly(contest.start_time);
  const academicStart = parseDateOnly(student.academic_start_date);
  const academicEnd = parseDateOnly(student.academic_end_date);

  if (academicStart && academicEnd) {
    academicEnd.setHours(23, 59, 59, 999);
    if (!contestDate || contestDate < academicStart || contestDate > academicEnd) {
      return 'NOT_APPLICABLE';
    }
  }

  // Manual override takes precedence over auto detection
  if (attendanceSource === 'MANUAL' && storedStatus) {
    return storedStatus;
  }

  // Auto: based on participation
  return participated ? 'PRESENT' : 'ABSENT';
}

/**
 * Get attendance data for a specific student.
 * @param {number} userId
 * @returns {object} - { history, metrics }
 */
async function getStudentAttendance(userId) {
  const [student] = await db.query(
    `SELECT id, name, roll_no, department, section, academic_start_date, academic_end_date, academic_batch,
            leetcode_username, codeforces_username, codechef_username, hackerrank_username
     FROM Users WHERE id = ?`,
    [userId]
  );
  if (!student) throw new Error('Student not found');

  const history = await db.query(
    `SELECT c.contest_id, c.title as contest_name, c.slug as contest_slug,
            c.start_time as contest_date, c.contest_status, c.duration,
            c.contest_type, c.platform,
            ar.attendance_status as stored_status, ar.attendance_source,
            ar.remarks, ar.last_updated, ar.rank, ar.score,
            ar.rating_before, ar.rating_after, ar.rating_change, ar.participated,
            (SELECT COUNT(*) FROM ParticipationLogs p WHERE p.contest_id = c.contest_id AND p.user_id = ?) as is_participated
     FROM Contests c
     LEFT JOIN AttendanceRecords ar ON c.contest_id = ar.contest_id AND ar.user_id = ?
     ORDER BY c.start_time ASC`,
    [userId, userId]
  );

  const formattedHistory = history.map(h => {
    const platformKey = h.platform ? h.platform.toLowerCase() : 'leetcode';
    const handle = student[`${platformKey}_username`];
    
    let status;
    if (!handle || !handle.trim()) {
      status = 'NOT_APPLICABLE';
    } else {
      const participated = Number(h.participated) > 0 || Number(h.is_participated) > 0;
      status = determineAttendanceStatus(
        student,
        h,
        participated,
        h.attendance_source,
        h.stored_status
      );
    }

    return {
      contest_id: h.contest_id,
      contest_name: h.contest_name,
      contest_slug: h.contest_slug,
      contest_date: h.contest_date,
      contest_status: h.contest_status,
      contest_type: h.contest_type || (h.contest_name?.toLowerCase().includes('biweekly') ? 'Biweekly' : 'Weekly'),
      platform: h.platform || 'LeetCode',
      attendance_status: status,
      attendance_source: h.attendance_source || 'AUTO',
      remarks: h.remarks || null,
      last_updated: h.last_updated,
      global_rank: h.rank || null,
      problems_solved: h.score || null,
      total_problems: h.platform?.toLowerCase() === 'leetcode' ? 4 : h.platform?.toLowerCase() === 'codechef' ? 6 : 6,
      rating: h.rating_after || null,
      rating_before: h.rating_before || null,
      rating_change: h.rating_change || 0,
      marked_by: h.attendance_source === 'MANUAL' ? 'Faculty' : 'System'
    };
  });

  const metrics = computeAttendanceMetrics(formattedHistory);

  return { student, history: formattedHistory, metrics };
}

/**
 * Compute attendance metrics from a formatted history array.
 * @param {Array} history
 * @returns {object}
 */
function computeAttendanceMetrics(history) {
  const eligible = history.filter(h =>
    h.attendance_status !== 'NOT_APPLICABLE' &&
    h.attendance_status !== 'ONGOING' &&
    h.attendance_status !== 'UNRATED'
  );
  const ratedEligible = eligible.filter(h =>
    h.attendance_status === 'PRESENT' || h.attendance_status === 'ABSENT'
  );
  const present = ratedEligible.filter(h => h.attendance_status === 'PRESENT').length;
  const absent = ratedEligible.filter(h => h.attendance_status === 'ABSENT').length;
  const totalRated = ratedEligible.length;
  const unrated = history.filter(h => h.attendance_status === 'UNRATED').length;
  const ongoing = history.filter(h => h.attendance_status === 'ONGOING').length;
  const notApplicable = history.filter(h => h.attendance_status === 'NOT_APPLICABLE').length;

  return {
    totalContests: history.length,
    eligibleContests: eligible.length,
    ratedContests: totalRated,
    unratedContests: unrated,
    ongoingContests: ongoing,
    notApplicable,
    present,
    absent,
    attendancePercentage: totalRated > 0 ? Math.round((present / totalRated) * 100) : 0
  };
}

/**
 * Override attendance for a student-contest pair (faculty manual).
 * @param {number} userId
 * @param {number} contestId
 * @param {string} status - 'PRESENT' | 'ABSENT'
 * @param {string} remarks
 */
async function overrideAttendance(userId, contestId, status, remarks = null) {
  if (!['PRESENT', 'ABSENT'].includes(status)) {
    throw new Error(`Invalid attendance status: ${status}. Must be PRESENT or ABSENT.`);
  }

  // Validate student and contest exist
  const [user] = await db.query('SELECT id FROM Users WHERE id = ?', [userId]);
  if (!user) throw new Error(`Student ID ${userId} not found`);

  const [contest] = await db.query('SELECT contest_id FROM Contests WHERE contest_id = ?', [contestId]);
  if (!contest) throw new Error(`Contest ID ${contestId} not found`);

  await db.query(
    `INSERT INTO AttendanceRecords (user_id, contest_id, attendance_status, attendance_source, remarks)
     VALUES (?, ?, ?, 'MANUAL', ?)
     ON DUPLICATE KEY UPDATE
       attendance_status = VALUES(attendance_status),
       attendance_source = 'MANUAL',
       remarks = VALUES(remarks),
       last_updated = CURRENT_TIMESTAMP`,
    [userId, contestId, status, remarks]
  );

  // Also ensure Registrations entry exists
  await db.query(
    'INSERT IGNORE INTO Registrations (user_id, contest_id) VALUES (?, ?)',
    [userId, contestId]
  );

  // If PRESENT, ensure ParticipationLog exists
  if (status === 'PRESENT') {
    await db.query(
      `INSERT IGNORE INTO ParticipationLogs (user_id, contest_id, join_time, participation_status)
       VALUES (?, ?, CURRENT_TIMESTAMP, 'MANUAL')`,
      [userId, contestId]
    );
  }
}

/**
 * Batch compute attendance summary stats for all active students.
 * Used by reports and dashboard.
 * @param {object} filters - { department?, section?, academicBatch? }
 * @returns {Array}
 */
async function getBatchAttendanceSummary({ department, section, academicBatch } = {}) {
  let filterSql = '';
  const params = [];

  if (department) { filterSql += ' AND u.department = ?'; params.push(department); }
  if (section) { filterSql += ' AND u.section = ?'; params.push(section); }
  if (academicBatch) { filterSql += ' AND u.academic_batch = ?'; params.push(academicBatch); }

  const rows = await db.query(
    `SELECT u.id, u.name, u.roll_no, u.department, u.section, u.academic_batch,
            u.leetcode_username, u.codechef_username, u.codeforces_username, u.hackerrank_username,
            u.academic_start_date, u.academic_end_date,
            (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Contests c ON ar.contest_id = c.contest_id
             WHERE ar.user_id = u.id AND c.contest_status = 'Rated' AND ar.attendance_status IN ('PRESENT', 'ABSENT')) as total_eligible,
            (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Contests c ON ar.contest_id = c.contest_id
             WHERE ar.user_id = u.id AND c.contest_status = 'Rated' AND ar.attendance_status = 'PRESENT') as attended_count
     FROM Users u
     WHERE u.status = 'active'${filterSql}
     ORDER BY u.department, u.section, u.roll_no`,
    params
  );

  return rows.map(r => {
    const total = Number(r.total_eligible || 0);
    const attended = Number(r.attended_count || 0);
    const absent = total - attended;
    return {
      ...r,
      total_eligible: total,
      attended_count: attended,
      absent_count: absent,
      attendance_percentage: total > 0 ? Math.round((attended / total) * 100) : 0
    };
  });
}

/**
 * Generate attendance sheet data for a specific contest.
 * @param {number} contestId
 * @returns {Array}
 */
async function getContestAttendanceSheet(contestId) {
  const rows = await db.query(
    `SELECT u.id as user_id, u.name, u.roll_no, u.department, u.section,
            u.leetcode_username, u.codechef_username, u.codeforces_username, u.hackerrank_username,
            ar.attendance_status, ar.attendance_source, ar.remarks,
            (SELECT COUNT(*) FROM ParticipationLogs p WHERE p.user_id = u.id AND p.contest_id = ?) as participated
     FROM Users u
     LEFT JOIN AttendanceRecords ar ON ar.user_id = u.id AND ar.contest_id = ?
     WHERE u.status = 'active'
     ORDER BY u.department, u.section, u.roll_no`,
    [contestId, contestId]
  );

  return rows.map(r => ({
    ...r,
    attendance_status: Number(r.participated) > 0 ? 'PRESENT' : (r.attendance_status || 'ABSENT'),
    participated: Number(r.participated || 0) > 0
  }));
}

/**
 * Backfill attendance records for all active users based on platform histories in DB.
 */
async function backfillAttendance(userId = null, updateProgress = () => {}) {
  const db = require('../config/db');
  const matchingSvc = require('./contestMatchingService');
  const cache = require('./analyticsCacheService');
  
  // 1. Fetch users
  let users = [];
  if (userId) {
    users = await db.query("SELECT id, name, roll_no, leetcode_username, codechef_username, codeforces_username FROM Users WHERE id = ?", [userId]);
  } else {
    users = await db.query("SELECT id, name, roll_no, leetcode_username, codechef_username, codeforces_username FROM Users WHERE status = 'active'");
  }

  if (users.length === 0) return { processed: 0, matched: 0 };

  // 2. Fetch master contests
  const masterContests = await db.query("SELECT contest_id, title, slug, start_time, contest_number, contest_type FROM Contests");

  updateProgress(10, `Loaded ${users.length} users and ${masterContests.length} master contests...`);

  let matchedCount = 0;
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    updateProgress(10 + Math.round((i / users.length) * 80), `Processing student ${user.name} (${i + 1}/${users.length})...`);

    // Fetch saved profiles for user to get contest history
    const profiles = [
      ['leetcode', await db.query("SELECT contest_history FROM LeetCodeProfiles WHERE user_id = ?", [user.id])],
      ['codechef', await db.query("SELECT contest_history FROM CodeChefProfiles WHERE user_id = ?", [user.id])],
      ['codeforces', await db.query("SELECT contest_history FROM CodeforcesProfiles WHERE user_id = ?", [user.id])]
    ];

    for (const [platform, rows] of profiles) {
      if (rows.length === 0) continue;
      let history = [];
      try {
        history = JSON.parse(rows[0].contest_history || '[]');
      } catch (e) {
        continue;
      }

      if (!Array.isArray(history)) continue;

      for (const entry of history) {
        const matchRes = await matchingSvc.matchContest(user.id, platform, entry, masterContests);
        if (matchRes && !matchRes.ambiguous) {
          // Ensure registered
          await db.query(
            "INSERT IGNORE INTO Registrations (user_id, contest_id) VALUES (?, ?)",
            [user.id, matchRes.match.contest_id]
          );
          // Insert participation log
          await db.query(
            `INSERT INTO ParticipationLogs (user_id, contest_id, join_time, participation_status)
             VALUES (?, ?, CURRENT_TIMESTAMP, 'JOINED')
             ON DUPLICATE KEY UPDATE join_time = CURRENT_TIMESTAMP`,
            [user.id, matchRes.match.contest_id]
          );
          matchedCount++;
        }
      }
    }
  }

  // 3. Clear cache
  updateProgress(95, 'Refreshing analytics cache...');
  cache.invalidateAll();

  updateProgress(100, `Completed! Processed ${users.length} students. Generated ${matchedCount} attendance records.`);
  return { processed: users.length, matched: matchedCount };
}

module.exports = {
  determineAttendanceStatus,
  getStudentAttendance,
  computeAttendanceMetrics,
  overrideAttendance,
  getBatchAttendanceSummary,
  getContestAttendanceSheet,
  parseDateOnly,
  backfillAttendance
};
