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
const { normalizeUsername } = require('../utils/usernameNormalizer');
const { normalizeBatchToShort } = require('../utils/batchHelper');
const AuditLogger = require('./AuditLogger');

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
 * Resolves the canonical attendance status for a student-contest pair using all available data sources.
 * This is the single source of truth for both summary and detail views.
 * 
 * @param {object} student - { academic_start_date, academic_end_date }
 * @param {object} contest - { start_time, duration, contest_status }
 * @param {object} record - { attendance_source, attendance_status, contest_rank, sync_status, registration_time, join_time }
 * @returns {object} - { status: 'PRESENT'|'ABSENT'|'UNKNOWN'|'ONGOING'|'UNRATED'|'NOT_APPLICABLE', reason: string }
 */
function resolveCanonicalStatus(student, contest, record = {}) {
  const now = new Date();
  const cDateVal = new Date(contest.start_time || contest.contest_date || contest.date);
  const durationMs = (Number(contest.duration) || 5400) * 1000;
  const contestEnd = new Date(cDateVal.getTime() + durationMs);
  const isOngoing = cDateVal <= now && contestEnd > now;
  const isUnrated = contest.contest_status && (contest.contest_status.toUpperCase() === 'UNRATED' || contest.contest_status.toUpperCase() === 'CANCELLED');
  const isRegistered = record.registration_time !== null && record.registration_time !== undefined;

  // Is student eligible (within academic period)?
  const contestDate = parseDateOnly(cDateVal);
  const academicStart = parseDateOnly(student.academic_start_date);
  const academicEnd = parseDateOnly(student.academic_end_date);

  if (academicStart && academicEnd) {
    academicEnd.setHours(23, 59, 59, 999);
    if (!contestDate || contestDate < academicStart || contestDate > academicEnd) {
      return { status: 'NOT_APPLICABLE', reason: 'Outside Academic Period' };
    }
  }

  if (isOngoing || now < cDateVal) {
    return { status: 'ONGOING', reason: 'Contest in progress' };
  }

  if (isUnrated) {
    return { status: 'UNRATED', reason: 'Unrated contest' };
  }

  // Priority 1: Manual Override
  if (record.attendance_source === 'MANUAL' && record.attendance_status) {
    const hasAttended = record.attendance_status === 'PRESENT';
    return {
      status: hasAttended ? 'PRESENT' : 'ABSENT',
      reason: hasAttended ? 'Manual Override (PRESENT)' : 'Manual Override (ABSENT)'
    };
  }

  // Priority 2: Official Leaderboard (from ContestAttendance)
  if (record.sync_status === 'Present' || record.sync_status === 'Participating') {
    return { status: 'PRESENT', reason: 'Participated via official leaderboard' };
  }

  // Priority 3: Contest Rank
  if (record.contest_rank !== null && record.contest_rank !== undefined && Number(record.contest_rank) > 0) {
    return { status: 'PRESENT', reason: 'Participated via official leaderboard' };
  }

  // Priority 4: Participation Log (join_time exists)
  if (record.join_time !== null && record.join_time !== undefined) {
    return { status: 'PRESENT', reason: 'Participation Log' };
  }

  // Priority 4b: Already marked PRESENT in database
  if (record.attendance_status === 'PRESENT') {
    return { status: 'PRESENT', reason: 'Participated via official leaderboard' };
  }

  // Priority 5: Incomplete Leaderboard
  if (record.sync_status === 'Unknown') {
    return { status: 'UNKNOWN', reason: 'Leaderboard Sync Incomplete' };
  }

  // Priority 6: Registered but missing
  if (isRegistered) {
    return { status: 'ABSENT', reason: 'Registered but Did Not Participate' };
  }

  // Priority 7: Not Registered
  return { status: 'ABSENT', reason: 'Not Registered' };
}

/**
 * Determine attendance status for a student-contest pair (backward compatibility).
 */
function determineAttendanceStatus(student, contest, participated, attendanceSource, storedStatus) {
  const record = {
    attendance_source: attendanceSource,
    attendance_status: storedStatus,
    join_time: participated ? new Date() : null,
    registration_time: participated ? new Date() : null,
    sync_status: participated ? 'Present' : null
  };
  const resolved = resolveCanonicalStatus(student, contest, record);
  return resolved.status;
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
            c.contest_type, c.platform, c.total_problems,
            ar.attendance_status as stored_status, ar.attendance_source,
            ar.remarks, ar.last_updated, ar.rank, ar.score, ar.problems_solved,
            ar.rating_before, ar.rating_after, ar.rating_change, ar.participated,
            (SELECT join_time FROM ParticipationLogs p WHERE p.contest_id = c.contest_id AND p.user_id = ?) as join_time,
            (SELECT registration_time FROM Registrations r WHERE r.contest_id = c.contest_id AND r.user_id = ?) as registration_time,
            (SELECT ca.attendanceStatus FROM ContestAttendance ca JOIN LiveContests lc ON ca.contestId = lc.id WHERE ca.studentId = ? AND lc.contestSlug = c.slug LIMIT 1) as sync_status,
            (SELECT ca.solved FROM ContestAttendance ca JOIN LiveContests lc ON ca.contestId = lc.id WHERE ca.studentId = ? AND lc.contestSlug = c.slug LIMIT 1) as sync_solved,
            (SELECT ca.score FROM ContestAttendance ca JOIN LiveContests lc ON ca.contestId = lc.id WHERE ca.studentId = ? AND lc.contestSlug = c.slug LIMIT 1) as sync_score
     FROM Contests c
     LEFT JOIN AttendanceRecords ar ON c.contest_id = ar.contest_id AND ar.user_id = ?
     ORDER BY c.start_time ASC`,
    [userId, userId, userId, userId, userId, userId]
  );

  const formattedHistory = history.map(h => {
    const platformKey = h.platform ? h.platform.toLowerCase() : 'leetcode';
    const handle = student[`${platformKey}_username`];
    
    let status;
    if (!handle || !handle.trim()) {
      status = 'NOT_APPLICABLE';
    } else {
      const record = {
        attendance_status: h.stored_status,
        attendance_source: h.attendance_source,
        contest_rank: h.rank,
        registration_time: h.registration_time,
        join_time: h.join_time,
        sync_status: h.sync_status
      };
      const resolved = resolveCanonicalStatus(student, h, record);
      status = resolved.status;
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
      problems_solved: h.problems_solved !== null ? h.problems_solved : (h.sync_solved !== null ? h.sync_solved : (status === 'PRESENT' ? 4 : 0)),
      problemsSolved: h.problems_solved !== null ? h.problems_solved : (h.sync_solved !== null ? h.sync_solved : (status === 'PRESENT' ? 4 : 0)),
      contest_score: h.score !== null ? parseFloat(h.score) : (h.sync_score !== null ? parseFloat(h.sync_score) : 0.00),
      contestScore: h.score !== null ? parseFloat(h.score) : (h.sync_score !== null ? parseFloat(h.sync_score) : 0.00),
      total_problems: h.total_problems || (h.platform?.toLowerCase() === 'leetcode' ? 4 : h.platform?.toLowerCase() === 'codechef' ? 6 : 6),
      totalProblems: h.total_problems || (h.platform?.toLowerCase() === 'leetcode' ? 4 : h.platform?.toLowerCase() === 'codechef' ? 6 : 6),
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

  const [contest] = await db.query('SELECT contest_id, title, slug, start_time, contest_status FROM Contests WHERE contest_id = ?', [contestId]);
  if (!contest) throw new Error(`Contest ID ${contestId} not found`);

  await db.query(
    `INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source, remarks)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?)
     ON DUPLICATE KEY UPDATE
       attendance_status = VALUES(attendance_status),
       attendance_source = 'MANUAL',
       remarks = VALUES(remarks),
       last_updated = CURRENT_TIMESTAMP`,
    [userId, contestId, contest.title, contest.slug, contest.start_time, contest.contest_status || 'RATED', status, remarks]
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
  } else {
    // If ABSENT, remove from ParticipationLogs so auto metrics reflect it
    await db.query(
      `DELETE FROM ParticipationLogs WHERE user_id = ? AND contest_id = ?`,
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

// ─────────────────────────────────────────────────────────────────────────────
// STAGE HELPERS — each has a single responsibility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage 1 — Load and validate contest metadata.
 * @throws if the contest is not found or metadata is incomplete.
 */
async function loadContest(contestId) {
  const isNumeric = /^\d+$/.test(String(contestId));
  const contestRows = isNumeric
    ? await db.query(
        'SELECT contest_id, platform, title, slug, contest_status, start_time, duration, total_problems FROM Contests WHERE contest_id = ?',
        [contestId]
      )
    : await db.query(
        'SELECT contest_id, platform, title, slug, contest_status, start_time, duration, total_problems FROM Contests WHERE slug = ?',
        [contestId]
      );

  if (contestRows.length === 0) {
    AuditLogger.fatal({ contestId, issue: 'Contest Missing', expected: 'Contest record in database', actual: 'None', action: 'Abort request' });
    throw new Error(`[FATAL] Contest not found for ID/Slug: ${contestId}`);
  }

  const contest = contestRows[0];
  if (!contest.title || !contest.slug || !contest.platform || !contest.start_time) {
    AuditLogger.fatal({ contestId: contest.contest_id, contestSlug: contest.slug, issue: 'Contest Metadata Incomplete', expected: 'All fields present', actual: JSON.stringify(contest), action: 'Abort request' });
    throw new Error(`[FATAL] Contest metadata incomplete for slug: ${contest.slug}`);
  }

  console.log(`[AUDIT] Stage: Load Contest | contest_id=${contest.contest_id} slug=${contest.slug} total_problems=${contest.total_problems || 4}`);
  return contest;
}

/**
 * Stage 2 — Load active students filtered by batch / department / section.
 */
async function loadEligibleStudents(filters = {}) {
  const { batch, department, section } = filters;
  let sql = `
    SELECT id, name, roll_no, department, section, academic_batch, academic_start_date, academic_end_date,
           leetcode_username, codechef_username, codeforces_username
    FROM Users
    WHERE status = 'active'
  `;
  const params = [];
  if (batch)      { sql += ' AND academic_batch = ?'; params.push(batch); }
  if (department) { sql += ' AND department = ?';     params.push(department); }
  if (section)    { sql += ' AND section = ?';        params.push(section); }

  const students = await db.query(sql, params);
  console.log(`[AUDIT] Stage: Load Students | Students=${students.length} | filters=${JSON.stringify({ batch, department, section })}`);
  return students;
}

/**
 * Stage 3a — Load registrations for the given contest + student IDs.
 */
async function loadRegistrations(contestId, studentIdList) {
  if (!studentIdList) return [];
  const rows = await db.query(
    `SELECT user_id, registration_time FROM Registrations WHERE contest_id = ? AND user_id IN (${studentIdList})`,
    [contestId]
  );
  console.log(`[AUDIT] Stage: Load Registrations | Registrations=${rows.length}`);
  return rows;
}

/**
 * Stage 3b — Load participation logs for the given contest + student IDs.
 */
async function loadParticipationLogs(contestId, studentIdList) {
  if (!studentIdList) return [];
  const rows = await db.query(
    `SELECT user_id, join_time FROM ParticipationLogs WHERE contest_id = ? AND user_id IN (${studentIdList})`,
    [contestId]
  );
  console.log(`[AUDIT] Stage: Load Participation Logs | Logs=${rows.length}`);
  return rows;
}

/**
 * Stage 3c — Load manual attendance overrides from AttendanceRecords.
 * CANONICAL OWNER of: attendance_status (MANUAL), remarks, attendance_source.
 */
async function loadAttendanceOverrides(contestId, studentIdList) {
  if (!studentIdList) return [];
  const rows = await db.query(
    `SELECT user_id, attendance_status, attendance_source, remarks, last_updated, rating_change
     FROM AttendanceRecords
     WHERE contest_id = ? AND user_id IN (${studentIdList})`,
    [contestId]
  );
  console.log(`[AUDIT] Stage: Load Attendance Overrides | Overrides=${rows.length}`);
  return rows;
}

/**
 * Stage 3d — Load sync metadata from ContestAttendance.
 * CANONICAL OWNER of: student mapping, verification status, syncPass.
 * ⚠ Metrics (rank/score/solved/penalty) in this table are WRITE-ONLY mirrors — never read for display.
 */
async function loadAttendanceMappings(contestSlug, studentIdList) {
  if (!studentIdList) return [];
  const rows = await db.query(
    `SELECT studentId, attendanceStatus, syncPass, verified
     FROM ContestAttendance
     WHERE contestId = (SELECT id FROM LiveContests WHERE contestSlug = ? LIMIT 1)
       AND studentId IN (${studentIdList})`,
    [contestSlug]
  );
  console.log(`[AUDIT] Stage: Load Attendance Mappings | Mappings=${rows.length}`);
  return rows;
}

/**
 * Stage 3e — Load standings from ContestParticipants.
 * CANONICAL OWNER of: rank, score, problems_solved, finish_time.
 * This is the ONLY source of contest metrics. No fallback to any other table.
 */
async function loadContestParticipants(contestSlug) {
  const rows = await db.query(
    `SELECT \`rank\`, score, problems_solved, finish_time, username
     FROM ContestParticipants
     WHERE contest_slug = ?`,
    [contestSlug]
  );
  console.log(`[AUDIT] Stage: Load Standings (ContestParticipants) | Standings=${rows.length} | slug=${contestSlug}`);
  return rows;
}

/**
 * Stage 3f — Load platform ratings for display.
 */
async function loadPlatformRatings(profileTable, studentIdList) {
  if (!studentIdList) return [];
  return db.query(`SELECT user_id, current_rating FROM ${profileTable} WHERE user_id IN (${studentIdList})`);
}

/**
 * Stage 4 — Resolve attendance status and build present/absent lists.
 * Uses: AttendanceRecords (override), ParticipationLogs (join_time), Registrations (registration_time).
 * Metrics come exclusively from ContestParticipants via participantMap.
 * NO fallback to ContestAttendance for metrics.
 */
function resolveAttendance({ students, contest, contestSlug, usernameCol, totalProblems, regMap, partMap, overrideMap, mappingMap, participantMap, ratingMap, defaultRating }) {
  const presentList = [];
  const absentList  = [];
  let matchedCount  = 0;
  let missingCount  = 0;

  for (const student of students) {
    const studentId = student.id;

    // Academic period gate
    if (student.academic_start_date && student.academic_end_date) {
      const contestDate  = parseDateOnly(contest.start_time);
      const academicStart = parseDateOnly(student.academic_start_date);
      const academicEnd   = parseDateOnly(student.academic_end_date);
      if (academicStart && academicEnd) {
        academicEnd.setHours(23, 59, 59, 999);
        if (!contestDate || contestDate < academicStart || contestDate > academicEnd) continue;
      }
    }

    const attRec  = overrideMap.get(studentId) || {};
    const regRec  = regMap.get(studentId)      || {};
    const partRec = partMap.get(studentId)     || {};
    const syncRec = mappingMap.get(studentId)  || {};

    const recordObj = {
      attendance_status: attRec.attendance_status || null,
      attendance_source: attRec.attendance_source || null,
      contest_rank:      syncRec.rank !== undefined ? syncRec.rank : null,
      registration_time: regRec.registration_time || null,
      join_time:         partRec.join_time || null,
      sync_status:       syncRec.attendanceStatus || null
    };

    const resolved = resolveCanonicalStatus(student, contest, recordObj);
    if (resolved.status === 'NOT_APPLICABLE') continue;

    // ── METRICS: ContestParticipants is the ONLY canonical source ──────────
    const platformUsername    = student[usernameCol] || '';
    const normalizedUsername  = normalizeUsername(platformUsername);
    const standing            = normalizedUsername ? participantMap.get(normalizedUsername) : null;

    let contestScore   = 0.00;
    let problemsSolved = 0;
    let contestRank    = null;
    let finishTime     = null;

    if (standing) {
      contestScore   = parseFloat(standing.score) || 0.00;
      problemsSolved = standing.problems_solved !== null ? standing.problems_solved : 0;
      contestRank    = standing.rank || null;
      finishTime     = standing.finish_time || null;
      matchedCount++;
    } else {
      // No entry in ContestParticipants → student did not participate on the platform
      // Metrics remain null/0. NO fallback to ContestAttendance.
      missingCount++;
    }
    // ───────────────────────────────────────────────────────────────────────

    const displayStatus = resolved.status.toLowerCase();

    const participantDetails = {
      student_id:        studentId,
      register_number:   student.roll_no,
      name:              student.name,
      department:        student.department,
      section:           student.section,
      academic_year:     student.academic_batch,
      platform_username: platformUsername,
      contest_date:      contest.start_time,
      contest_slug:      contestSlug,
      contest_status:    contest.contest_status,
      registration_time: regRec.registration_time || null,
      join_time:         partRec.join_time || null,
      current_rating:    ratingMap.get(studentId) || defaultRating,
      status:            displayStatus,
      marked_by:         attRec.attendance_source === 'MANUAL' ? 'faculty' : 'system',
      remarks:           attRec.remarks || null,
      last_updated:      attRec.last_updated || null,
      contest_rank:      contestRank,
      rating_change:     attRec.rating_change || 0,
      problems_solved:   problemsSolved,
      problemsSolved:    problemsSolved,
      contest_score:     contestScore,
      contestScore:      contestScore,
      total_problems:    totalProblems,
      totalProblems:     totalProblems,
      finishTime:        finishTime,
      reason:            resolved.reason
    };

    if (displayStatus === 'present') {
      presentList.push(participantDetails);
    } else {
      absentList.push(participantDetails);
    }
  }

  console.log(`[AUDIT] Stage: Username Match | Matched=${matchedCount} Missing=${missingCount} (from ContestParticipants only)`);
  console.log(`[AUDIT] Stage: Attendance Resolution | Present=${presentList.length} Absent=${absentList.length}`);

  return { presentList, absentList };
}

/**
 * Stage 5 — Calculate summary counts from the resolved lists.
 * Called BEFORE validation so counts are never affected by metric validity.
 */
function buildSummary(presentList, absentList) {
  const registered          = presentList.length + absentList.length;
  const attended            = presentList.length;
  const missed              = absentList.length;
  const attendancePercentage = registered > 0 ? Math.round((attended / registered) * 100) : 0;

  const summary = { registered, attended, missed, attendancePercentage };
  console.log(`[AUDIT] Stage: Build Summary | Registered=${registered} Attended=${attended} Missed=${missed} Rate=${attendancePercentage}%`);
  return summary;
}

/**
 * Stage 6 — Validate contest metrics and nullify corrupted entries.
 * A corrupted student stays in the present/absent list; only their metrics are nullified.
 * Attendance counts NEVER change here.
 */
function validateContestMetrics(presentList, absentList, contest, contestSlug, validationIssues) {
  const seenUsernames  = new Set();
  const seenStudentIds = new Set();
  const rankMap        = new Map();
  let invalidCount     = 0;
  let validCount       = 0;

  for (const p of [...presentList, ...absentList]) {
    let isCorrupted     = false;
    const studentId     = p.student_id;
    const normUsername  = normalizeUsername(p.platform_username);

    if (p.problemsSolved > p.totalProblems) {
      AuditLogger.error({ contestId: contest.contest_id, contestSlug, userId: studentId, username: p.platform_username, issue: 'ProblemsSolved > TotalProblems', expected: `<= ${p.totalProblems}`, actual: p.problemsSolved, action: 'Nullify metrics' });
      validationIssues.push(`ProblemsSolved (${p.problemsSolved}) > TotalProblems (${p.totalProblems}) for student ${p.name}`);
      isCorrupted = true;
    }

    if (p.contestScore < 0) {
      AuditLogger.error({ contestId: contest.contest_id, contestSlug, userId: studentId, username: p.platform_username, issue: 'Negative Score', expected: '>= 0', actual: p.contestScore, action: 'Nullify metrics' });
      validationIssues.push(`Negative score (${p.contestScore}) for student ${p.name}`);
      isCorrupted = true;
    }

    if (seenStudentIds.has(studentId)) {
      AuditLogger.error({ contestId: contest.contest_id, contestSlug, userId: studentId, username: p.platform_username, issue: 'Duplicate Participant', expected: 'Unique student_id per contest', actual: studentId, action: 'Nullify metrics' });
      validationIssues.push(`Duplicate student ID ${studentId} for student ${p.name}`);
      isCorrupted = true;
    }
    seenStudentIds.add(studentId);

    if (p.platform_username) {
      if (seenUsernames.has(normUsername)) {
        AuditLogger.error({ contestId: contest.contest_id, contestSlug, userId: studentId, username: p.platform_username, issue: 'Duplicate Participant (username)', expected: 'Unique username per contest', actual: p.platform_username, action: 'Nullify metrics' });
        validationIssues.push(`Duplicate platform username ${p.platform_username}`);
        isCorrupted = true;
      }
      seenUsernames.add(normUsername);
    }

    if (p.contest_rank !== null) {
      if (rankMap.has(p.contest_rank)) {
        const existing = rankMap.get(p.contest_rank);
        if (existing.score !== p.contestScore || existing.finishTime !== p.finishTime) {
          AuditLogger.error({ contestId: contest.contest_id, contestSlug, userId: studentId, username: p.platform_username, issue: 'Duplicate Rank Tie Violation', expected: `Identical score (${existing.score}) and finishTime (${existing.finishTime})`, actual: `Score (${p.contestScore}) and finishTime (${p.finishTime})`, action: 'Nullify metrics' });
          validationIssues.push(`Duplicate rank ${p.contest_rank} with non-matching metrics for student ${p.name}`);
          isCorrupted = true;
        }
      } else {
        rankMap.set(p.contest_rank, { score: p.contestScore, finishTime: p.finishTime });
      }
    }

    if (!p.platform_username) {
      AuditLogger.error({ contestId: contest.contest_id, contestSlug, userId: studentId, issue: 'Missing Username', expected: 'Valid platform handle', actual: 'None', action: 'Nullify metrics' });
      validationIssues.push(`Missing platform username for student ${p.name}`);
      isCorrupted = true;
    }

    if (p.finishTime !== null && p.finishTime < 0) {
      AuditLogger.error({ contestId: contest.contest_id, contestSlug, userId: studentId, username: p.platform_username, issue: 'Invalid Finish Time', expected: '>= 0', actual: p.finishTime, action: 'Nullify metrics' });
      validationIssues.push(`Negative finish time (${p.finishTime}) for student ${p.name}`);
      isCorrupted = true;
    }

    if (isCorrupted) {
      p.contest_rank   = null;
      p.problems_solved = null;
      p.problemsSolved  = null;
      p.contest_score   = null;
      p.contestScore    = null;
      p.finishTime      = null;
      invalidCount++;
    } else {
      validCount++;
    }
  }

  console.log(`[AUDIT] Stage: Validation | Invalid Metrics=${invalidCount} Valid Metrics=${validCount}`);
}

/**
 * Stage 7 — Build the final response object.
 */
function buildResponse(summary, presentList, absentList, validationStatus, validationIssues) {
  return { summary, present: presentList, absent: absentList, validationStatus, validationIssues };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ORCHESTRATOR — unchanged external API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get detailed participants and missed lists for a contest.
 * Single source of truth for both details view and summary statistics.
 */
async function resolveCanonicalContestParticipants(contestId, filters = {}) {
  let { batch, department, section } = filters;
  batch = normalizeBatchToShort(batch);
  const normalizedFilters = { batch, department, section };

  const validationIssues = [];
  let validationStatus   = 'PASSED';

  // Stage 1 – Load contest
  const contest     = await loadContest(contestId);
  const contestSlug = contest.slug;
  const totalProblems = contest.total_problems || 4;

  const platform      = (contest.platform || 'LeetCode').toLowerCase();
  const usernameCol   = `${platform}_username`;
  const profileTable  = platform === 'leetcode' ? 'LeetCodeProfiles'
                      : platform === 'codechef'  ? 'CodeChefProfiles'
                      : 'CodeforcesProfiles';
  const defaultRating = platform === 'leetcode' ? 1500 : 0;

  // Stage 2 – Load students (filter-aware)
  const students      = await loadEligibleStudents(normalizedFilters);
  const studentIds    = students.map(s => s.id);
  const studentIdList = studentIds.length > 0 ? studentIds.join(',') : null;

  // Stage 3 – Load all data sources in parallel (batch queries — no N+1)
  const [ratings, registrations, partLogs, overrides, mappings, standings] = await Promise.all([
    loadPlatformRatings(profileTable, studentIdList),
    loadRegistrations(contest.contest_id, studentIdList),
    loadParticipationLogs(contest.contest_id, studentIdList),
    loadAttendanceOverrides(contest.contest_id, studentIdList),
    loadAttendanceMappings(contestSlug, studentIdList),
    loadContestParticipants(contestSlug)
  ]);

  // Build O(1) lookup maps
  const ratingMap      = new Map(ratings.map(r => [r.user_id, r.current_rating]));
  const regMap         = new Map(registrations.map(r => [r.user_id, r]));
  const partMap        = new Map(partLogs.map(p => [p.user_id, p]));
  const overrideMap    = new Map(overrides.map(o => [o.user_id, o]));
  const mappingMap     = new Map(mappings.map(m => [m.studentId, m]));
  const participantMap = new Map();
  standings.forEach(s => {
    if (s.username) participantMap.set(normalizeUsername(s.username), s);
  });

  // Stage 4 – Resolve attendance and build present/absent lists
  const { presentList, absentList } = resolveAttendance({
    students, contest, contestSlug, usernameCol, totalProblems,
    regMap, partMap, overrideMap, mappingMap, participantMap, ratingMap, defaultRating
  });

  // Stage 5 – Build summary BEFORE validation (counts must not change after this)
  const summary = buildSummary(presentList, absentList);

  // Stage 6 – Validate metrics and nullify corrupted entries (lists are not filtered)
  validateContestMetrics(presentList, absentList, contest, contestSlug, validationIssues);

  if (validationIssues.length > 0) {
    validationStatus = 'INVALID_METRICS';
  }

  // Stage 7 – Build response
  return buildResponse(summary, presentList, absentList, validationStatus, validationIssues);
}

async function getContestParticipantsDetails(contestId, filters = {}) {
  const result = await resolveCanonicalContestParticipants(contestId, filters);
  return {
    count: result.present.length + result.absent.length,
    data: [...result.present, ...result.absent],
    attended: result.present,
    missed: result.absent,
    summary: result.summary,
    validationStatus: result.validationStatus,
    validationIssues: result.validationIssues
  };
}

/**
 * Aggregates statistics for all contests of a platform in a single batch in-memory calculation.
 * Ensures summary counts are always exactly equal to the sum of the details.
 */
async function getPlatformContestsStatistics(platform, filters = {}) {
  let { batch, department, section } = filters;
  batch = normalizeBatchToShort(batch);

  // 1. Fetch platform contests
  const contests = await db.query(
    "SELECT contest_id FROM Contests WHERE platform = ?",
    [platform]
  );

  const statsMap = {};
  for (const c of contests) {
    const res = await resolveCanonicalContestParticipants(c.contest_id, filters);
    statsMap[c.contest_id] = {
      total: res.summary.registered,
      attended: res.summary.attended,
      missed: res.summary.missed,
      rate: res.summary.attendancePercentage
    };
  }

  return statsMap;
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

async function getPlatformAnalyticsData(platform, studentId, filters = {}) {
  let { batch, department, section } = filters;
  batch = normalizeBatchToShort(batch);

  // 1. Fetch platform contests
  const contests = await db.query(
    `SELECT contest_id, title as contest_name, slug as contest_slug, start_time as contest_date, contest_status, contest_type, duration, total_problems 
     FROM Contests 
     WHERE platform = ?
     ORDER BY start_time DESC`,
    [platform]
  );

  // If studentId !== 'all', load student info and profile
  let student = null;
  let rawHistory = [];
  if (studentId !== 'all') {
    const studentRows = await db.query("SELECT * FROM Users WHERE id = ?", [studentId]);
    if (studentRows.length > 0) {
      student = studentRows[0];
      const usernameCol = `${platform.toLowerCase()}_username`;
      const profileTable = platform.toLowerCase() === 'leetcode' ? 'LeetCodeProfiles' : 
                           platform.toLowerCase() === 'codechef' ? 'CodeChefProfiles' : 'CodeforcesProfiles';
      
      const profiles = await db.query(`SELECT contest_history FROM ${profileTable} WHERE user_id = ?`, [studentId]);
      if (profiles.length > 0 && profiles[0].contest_history) {
        try {
          rawHistory = typeof profiles[0].contest_history === 'string' ? JSON.parse(profiles[0].contest_history) : profiles[0].contest_history;
        } catch (e) {
          rawHistory = [];
        }
      }
    }
  }

  const resultContests = [];

  for (const c of contests) {
    // Call resolveCanonicalContestParticipants to get single canonical resolution!
    const canonical = await resolveCanonicalContestParticipants(c.contest_id, filters);

    // Get statistics
    const regCount = canonical.summary.registered;
    const attCount = canonical.summary.attended;

    let status = 'not attended';
    let attendanceStatus = 'ABSENT';
    let eligibilityStatus = 'Eligible';
    let remarks = null;
    let lastUpdated = null;
    let problemsSolved = null;
    let contestScore = null;
    let contestRank = null;
    let ratingChange = 0;
    let rating = null;

    const totalProblems = c.total_problems || (platform.toLowerCase() === 'leetcode' ? 4 : 6);

    if (studentId !== 'all' && student) {
      const matchedPresent = canonical.present.find(p => p.student_id === student.id);
      const matchedAbsent = canonical.absent.find(p => p.student_id === student.id);

      if (matchedPresent) {
        attendanceStatus = 'PRESENT';
        status = 'attended';
        remarks = matchedPresent.remarks;
        lastUpdated = matchedPresent.last_updated;
        problemsSolved = matchedPresent.problemsSolved;
        contestScore = matchedPresent.contestScore;
        contestRank = matchedPresent.contest_rank;
        ratingChange = matchedPresent.rating_change || 0;
      } else if (matchedAbsent) {
        attendanceStatus = 'ABSENT';
        status = 'not attended';
        remarks = matchedAbsent.remarks;
        lastUpdated = matchedAbsent.last_updated;
        problemsSolved = matchedAbsent.problemsSolved;
        contestScore = matchedAbsent.contestScore;
        contestRank = matchedAbsent.contest_rank;
        ratingChange = matchedAbsent.rating_change || 0;
      } else {
        attendanceStatus = 'NOT_APPLICABLE';
        status = 'not_applicable';
        eligibilityStatus = 'Outside Academic Period';
      }

      // Merge crawler history profile if available
      let perfMatch = null;
      if (platform.toLowerCase() === 'leetcode') {
        perfMatch = rawHistory.find(h => 
          (h.contest && h.contest.title?.trim().toLowerCase() === c.contest_name.trim().toLowerCase()) ||
          (h.contest && h.contest.titleSlug?.trim().toLowerCase() === c.contest_slug?.trim().toLowerCase())
        );
        if (perfMatch) {
          if (contestRank === null) contestRank = perfMatch.ranking;
          if (rating === null) rating = perfMatch.rating ? Math.round(perfMatch.rating) : null;
          if (ratingChange === 0) ratingChange = perfMatch.ratingChange ? parseFloat(perfMatch.ratingChange) : 0;
        }
      } else if (platform.toLowerCase() === 'codechef') {
        perfMatch = rawHistory.find(h => 
          (h.contestName || '').trim().toLowerCase() === c.contest_name.trim().toLowerCase()
        );
        if (perfMatch) {
          if (contestRank === null) contestRank = perfMatch.rank;
          if (rating === null) rating = perfMatch.newRating;
          if (ratingChange === 0) ratingChange = perfMatch.ratingChange || 0;
        }
      } else if (platform.toLowerCase() === 'codeforces') {
        const cfContestIdMatch = c.contest_slug ? c.contest_slug.match(/codeforces-(\d+)/) : null;
        const cfId = cfContestIdMatch ? parseInt(cfContestIdMatch[1]) : -1;
        perfMatch = rawHistory.find(h => 
          h.contestId === cfId || (h.contestName || '').trim().toLowerCase() === c.contest_name.trim().toLowerCase()
        );
        if (perfMatch) {
          if (contestRank === null) contestRank = perfMatch.rank;
          if (rating === null) rating = perfMatch.newRating;
          if (ratingChange === 0) ratingChange = (perfMatch.newRating && perfMatch.oldRating) ? (perfMatch.newRating - perfMatch.oldRating) : 0;
        }
      }
    }

    // Map dynamic, platform-specific categories into type field
    let resolvedType = c.contest_type ? c.contest_type.toLowerCase() : 'weekly';
    const nameLower = c.contest_name.toLowerCase();
    if (platform.toLowerCase() === 'codechef') {
      resolvedType = 'starters';
      if (nameLower.includes('cook-off') || nameLower.includes('cook')) resolvedType = 'cook-off';
      else if (nameLower.includes('lunchtime')) resolvedType = 'lunchtime';
      else if (nameLower.includes('long challenge') || nameLower.includes('long')) resolvedType = 'long challenge';
    } else if (platform.toLowerCase() === 'codeforces') {
      resolvedType = 'div2';
      if (nameLower.includes('div 1') || nameLower.includes('div. 1')) resolvedType = 'div1';
      else if (nameLower.includes('div 2') || nameLower.includes('div. 2')) resolvedType = 'div2';
      else if (nameLower.includes('div 3') || nameLower.includes('div. 3')) resolvedType = 'div3';
      else if (nameLower.includes('div 4') || nameLower.includes('div. 4')) resolvedType = 'div4';
      else if (nameLower.includes('educational')) resolvedType = 'educational';
      else if (nameLower.includes('global')) resolvedType = 'global';
    }

    resultContests.push({
      id: c.contest_id,
      contest_id: c.contest_slug,
      name: c.contest_name,
      date: c.contest_date,
      type: resolvedType,
      status,
      attendance_status: attendanceStatus,
      attendance_source: studentId !== 'all' ? (matchedPresent?.marked_by === 'faculty' ? 'MANUAL' : 'AUTO') : 'AUTO',
      eligibility_status: eligibilityStatus,
      remarks,
      last_updated: lastUpdated,
      global_rank: contestRank,
      rating,
      rating_change: ratingChange,
      problems_solved: problemsSolved,
      problemsSolved,
      contest_score: contestScore,
      contestScore,
      total_problems: totalProblems,
      totalProblems,
      registration_count: regCount,
      attendance_count: attCount,
      validationStatus: canonical.validationStatus,
      validationIssues: canonical.validationIssues
    });
  }

  return resultContests;
}

async function getPlatformAnalytics(platform, studentId, filters = {}) {
  let { batch, type, status, startDate, endDate } = filters;
  
  const dbPlatformMap = {
    leetcode: 'LeetCode',
    codechef: 'CodeChef',
    codeforces: 'Codeforces'
  };
  const dbPlatform = dbPlatformMap[platform.toLowerCase()];
  if (!dbPlatform) {
    throw new Error('Invalid platform specified.');
  }

  // 1. Fetch raw canonical contests list
  let contests = await getPlatformAnalyticsData(platform, studentId, filters);

  // 2. Fetch platformRanking if studentId !== 'all'
  let platformRanking = null;
  const usernameCol = `${platform.toLowerCase()}_username`;
  const profileTable = platform.toLowerCase() === 'leetcode' ? 'LeetCodeProfiles' : 
                       platform.toLowerCase() === 'codechef' ? 'CodeChefProfiles' : 'CodeforcesProfiles';

  let studentInfo = null;
  if (studentId !== 'all') {
    const studentRows = await db.query(
      `SELECT id, name, roll_no, department, section, academic_batch, academic_start_date, academic_end_date, ${usernameCol} as platform_username 
       FROM Users 
       WHERE id = ?`,
      [studentId]
    );
    if (studentRows.length > 0) {
      studentInfo = studentRows[0];
    }

    let profileRows = [];
    if (platform.toLowerCase() === 'codeforces') {
      profileRows = await db.query(
        `SELECT current_rating, highest_rating, contest_history FROM CodeforcesProfiles WHERE user_id = ?`,
        [studentId]
      );
    } else {
      profileRows = await db.query(
        `SELECT current_rating, highest_rating, global_ranking, contest_history FROM ${profileTable} WHERE user_id = ?`,
        [studentId]
      );
    }
    const profile = profileRows.length > 0 ? profileRows[0] : null;
    let rawHistory = [];
    if (profile && profile.contest_history) {
      try {
        rawHistory = typeof profile.contest_history === 'string' ? JSON.parse(profile.contest_history) : profile.contest_history;
      } catch (e) {
        rawHistory = [];
      }
    }

    const attendedCount = contests.filter(c => c.attendance_status === 'PRESENT').length;
    if (profile) {
      if (platform.toLowerCase() === 'leetcode') {
        platformRanking = {
          rating: parseFloat(profile.current_rating || 1500),
          globalRanking: profile.global_ranking,
          attendedContestsCount: attendedCount
        };
      } else if (platform.toLowerCase() === 'codechef') {
        platformRanking = {
          rating: profile.current_rating || 0,
          highestRating: profile.highest_rating || 0,
          globalRanking: profile.global_ranking || null,
          attendedContestsCount: attendedCount
        };
      } else if (platform.toLowerCase() === 'codeforces') {
        const detailRows = await db.query(
          "SELECT `rank`, max_rank FROM CodeforcesProfiles WHERE user_id = ?",
          [studentId]
        );
        platformRanking = {
          rating: profile.current_rating || 0,
          highestRating: profile.highest_rating || 0,
          rank: detailRows.length > 0 ? detailRows[0].rank : null,
          maxRank: detailRows.length > 0 ? detailRows[0].max_rank : null,
          attendedContestsCount: attendedCount
        };
      }
    }
  }

  // 3. Apply post filters
  if (type) {
    contests = contests.filter(c => c.type === type.toLowerCase());
  }
  if (startDate) {
    const startLimit = new Date(startDate);
    contests = contests.filter(c => new Date(c.date) >= startLimit);
  }
  if (endDate) {
    const endLimit = new Date(endDate);
    contests = contests.filter(c => new Date(c.date) <= endLimit);
  }
  if (status) {
    contests = contests.filter(c => {
      if (status === 'present') return c.attendance_status === 'PRESENT';
      if (status === 'absent') return c.attendance_status === 'ABSENT';
      return c.attendance_status.toLowerCase() === status.toLowerCase();
    });
  }

  // 4. Calculate Platform Statistics
  const eligibleContestsList = contests.filter(c => c.eligibility_status === 'Eligible');
  const ratedEligibleRecords = eligibleContestsList.filter(c => c.attendance_status === 'PRESENT' || c.attendance_status === 'ABSENT');
  const totalRated = ratedEligibleRecords.length;
  const ongoing = eligibleContestsList.filter(c => c.attendance_status === 'ONGOING').length;

  let batchStudentsCount = 1;
  const shortBatch = normalizeBatchToShort(batch);
  if (studentId === 'all') {
    const studentCountRows = await db.query(
      `SELECT COUNT(*) as count FROM Users WHERE status = 'active' ${shortBatch ? 'AND academic_batch = ?' : ''}`,
      shortBatch ? [shortBatch] : []
    );
    batchStudentsCount = studentCountRows[0]?.count || 1;
  }

  let attended = 0;
  let attendancePercentage = 100.0;

  if (studentId !== 'all') {
    attended = ratedEligibleRecords.filter(c => c.attendance_status === 'PRESENT').length;
    attendancePercentage = totalRated > 0 ? parseFloat(Math.min(100, (attended / totalRated) * 100).toFixed(1)) : 100.0;
  } else {
    const totalAttended = ratedEligibleRecords.reduce((acc, c) => acc + (c.attendance_count || 0), 0);
    const totalPossible = batchStudentsCount * totalRated;
    attendancePercentage = totalPossible > 0 ? parseFloat(Math.min(100, (totalAttended / totalPossible) * 100).toFixed(1)) : 100.0;
    attended = Math.round(totalRated * (attendancePercentage / 100));
  }

  const missed = Math.max(0, totalRated - attended);

  const metrics = {
    eligible: totalRated,
    attended: Math.min(totalRated, attended),
    missed,
    rate: attendancePercentage,
    ongoing
  };

  // 5. Monthly Attendance Trend
  const monthlyGroups = {};
  eligibleContestsList.forEach(item => {
    const d = new Date(item.date);
    if (isNaN(d.getTime())) return;
    
    const year = d.getFullYear();
    const monthVal = d.getMonth();
    const monthKey = `${year}-${String(monthVal + 1).padStart(2, '0')}`;
    
    if (!monthlyGroups[monthKey]) {
      monthlyGroups[monthKey] = {
        key: monthKey,
        monthName: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        present: 0,
        total: 0
      };
    }
    
    const group = monthlyGroups[monthKey];
    if (studentId !== 'all') {
      group.total++;
      if (item.attendance_status === 'PRESENT') {
        group.present++;
      }
    } else {
      group.present += (item.attendance_count || 0);
      group.total += batchStudentsCount;
    }
  });

  const monthlyTrendData = Object.values(monthlyGroups)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(g => ({
      name: g.monthName,
      rate: g.total > 0 ? Math.round((g.present / g.total) * 100) : 0,
      present: g.present,
      total: g.total
    }))
    .slice(-24);

  // 6. Semester Analytics
  let semesterStart = new Date('2023-07-01');
  if (studentId !== 'all' && studentInfo?.academic_start_date) {
    semesterStart = new Date(studentInfo.academic_start_date);
  } else if (shortBatch) {
    const startYear = parseInt(shortBatch.split('-')[0], 10);
    semesterStart = !isNaN(startYear) ? new Date(`${startYear}-07-01`) : new Date('2024-07-01');
  }

  const semestersData = {};
  for (let i = 1; i <= 8; i++) {
    semestersData[i] = {
      semester: `Sem ${i}`,
      semesterNum: i,
      total: 0,
      present: 0,
      absent: 0
    };
  }

  eligibleContestsList.forEach(item => {
    const d = new Date(item.date);
    if (isNaN(d.getTime())) return;
    
    const startYear = semesterStart.getFullYear();
    const startMonth = semesterStart.getMonth();
    const itemYear = d.getFullYear();
    const itemMonth = d.getMonth();
    
    const monthsDiff = (itemYear - startYear) * 12 + (itemMonth - startMonth);
    if (monthsDiff < 0) return;
    
    const sem = Math.floor(monthsDiff / 6) + 1;
    if (sem < 1 || sem > 8) return;
    
    const group = semestersData[sem];
    if (studentId !== 'all') {
      group.total++;
      if (item.attendance_status === 'PRESENT') {
        group.present++;
      } else {
        group.absent++;
      }
    } else {
      group.present += (item.attendance_count || 0);
      group.total += batchStudentsCount;
      group.absent += Math.max(0, batchStudentsCount - (item.attendance_count || 0));
    }
  });

  const semesterAnalyticsData = Object.values(semestersData).map(s => {
    let total = s.total;
    let present = s.present;
    let absent = s.absent;
    
    if (studentId === 'all') {
      total = Math.round(s.total / batchStudentsCount);
      present = Math.round(s.present / batchStudentsCount);
      absent = Math.round(s.absent / batchStudentsCount);
    }
    
    const rate = total > 0 ? parseFloat(((present / total) * 100).toFixed(1)) : 0;
    return {
      semester: s.semester,
      semesterNum: s.semesterNum,
      total,
      present,
      absent,
      rate
    };
  });

  // 7. Batch Comparison
  let targetBatches = [];
  if (shortBatch) {
    targetBatches = [shortBatch];
  } else {
    const activeBatchesList = await db.query(
      `SELECT DISTINCT academic_batch 
       FROM Users 
       WHERE status = 'active' 
         AND academic_batch IS NOT NULL 
         AND academic_batch != ''
       ORDER BY academic_batch ASC`
    );
    targetBatches = activeBatchesList.map(item => item.academic_batch);
  }

  const batchComparisonData = await Promise.all(targetBatches.map(async (b) => {
    const studentsInBatch = await db.query(
      `SELECT u.id, u.name, ROUND(IFNULL(p.current_rating, ${platform.toLowerCase() === 'leetcode' ? 1500 : 0})) as rating
       FROM Users u
       LEFT JOIN ${profileTable} p ON u.id = p.user_id
       WHERE u.academic_batch = ? AND u.status = 'active'`,
      [b]
    );
    const totalStudents = studentsInBatch.length;

    let avgAttendance = 0;
    let avgRating = platform.toLowerCase() === 'leetcode' ? 1500 : 0;

    if (totalStudents > 0) {
      const studentIdsInBatch = studentsInBatch.map(s => s.id);
      const attStats = await db.query(
        `SELECT 
           COUNT(CASE WHEN ar.attendance_status = 'PRESENT' THEN 1 END) as attended,
           COUNT(CASE WHEN ar.attendance_status IN ('PRESENT', 'ABSENT') THEN 1 END) as total
         FROM AttendanceRecords ar
         JOIN Contests c ON ar.contest_id = c.contest_id
         WHERE ar.user_id IN (${studentIdsInBatch.join(',')}) AND c.platform = ? AND c.contest_status = 'Rated'`,
        [dbPlatform]
      );
      
      const totalEligibleRecords = attStats[0]?.total || 0;
      const totalAttendedRecords = attStats[0]?.attended || 0;
      
      avgAttendance = totalEligibleRecords > 0 
        ? parseFloat(((totalAttendedRecords / totalEligibleRecords) * 100).toFixed(1))
        : 0;

      avgRating = Math.round(studentsInBatch.reduce((acc, s) => acc + s.rating, 0) / totalStudents);
    }

    const formatBatchToLong = (bStr) => {
      if (!bStr) return 'Unknown Batch';
      const parts = bStr.split('-');
      if (parts.length < 2) return bStr;
      const start = parseInt(parts[0], 10);
      const end = parseInt(parts[1], 10);
      if (isNaN(start) || isNaN(end)) return bStr;
      const startYear = start < 100 ? 2000 + start : start;
      const endYear = end < 100 ? 2000 + end : end;
      return `${startYear} - ${endYear} Batch`;
    };

    return {
      name: formatBatchToLong(b),
      attendance: avgAttendance,
      rating: avgRating,
      participants: totalStudents
    };
  }));

  // 8. Student Summaries
  let studentSummariesFilter = '';
  const studentSummaryParams = [dbPlatform, dbPlatform];
  if (shortBatch) {
    studentSummariesFilter += ' AND u.academic_batch = ?';
    studentSummaryParams.push(shortBatch);
  }

  const studentSummariesRows = await db.query(
    `SELECT u.id, u.name, u.roll_no as register_number, u.department, u.section, u.academic_batch as academic_year,
            ROUND(IFNULL(p.current_rating, ${platform.toLowerCase() === 'leetcode' ? 1500 : 0})) as current_rating,
            ROUND(IFNULL(p.highest_rating, ${platform.toLowerCase() === 'leetcode' ? 1500 : 0})) as best_rating,
            (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Contests c ON ar.contest_id = c.contest_id
             WHERE ar.user_id = u.id AND c.platform = ? AND c.contest_status = 'Rated' AND ar.attendance_status IN ('PRESENT', 'ABSENT')) as total_eligible,
            (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Contests c ON ar.contest_id = c.contest_id
             WHERE ar.user_id = u.id AND c.platform = ? AND c.contest_status = 'Rated' AND ar.attendance_status = 'PRESENT') as attended_count
     FROM Users u
     LEFT JOIN ${profileTable} p ON u.id = p.user_id
     WHERE u.status = 'active'${studentSummariesFilter}
     ORDER BY u.department, u.section, u.roll_no`,
    studentSummaryParams
  );

  const studentSummaries = studentSummariesRows.map(r => {
    const eligible = r.total_eligible || 0;
    const attendedVal = r.attended_count || 0;
    const rate = eligible > 0 ? Math.round((attendedVal / eligible) * 100) : 0;
    return {
      id: r.id,
      name: r.name,
      register_number: r.register_number,
      department: r.department,
      section: r.section,
      academic_year: r.academic_year,
      current_rating: r.current_rating,
      best_rating: r.best_rating,
      total_eligible: eligible,
      attended_count: attendedVal,
      absent_count: Math.max(0, eligible - attendedVal),
      attendance_percentage: rate
    };
  });

  return {
    platform: platform.toLowerCase(),
    metrics,
    contests,
    monthlyTrendData,
    semesterAnalyticsData,
    batchComparisonData,
    studentSummaries,
    platformRanking
  };
}

module.exports = {
  determineAttendanceStatus,
  resolveCanonicalStatus,
  getStudentAttendance,
  computeAttendanceMetrics,
  overrideAttendance,
  getContestAttendanceSheet,
  parseDateOnly,
  backfillAttendance,
  getContestParticipantsDetails,
  getPlatformContestsStatistics,
  resolveCanonicalContestParticipants,
  getPlatformAnalyticsData,
  getPlatformAnalytics
};
