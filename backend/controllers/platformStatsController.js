/**
 * platformStatsController.js
 * ============================
 * Per-student platform contest stats:
 * - LeetCode: weekly / biweekly solved count this week + this month
 * - CodeChef: Wednesday (Starters) contest weekly / monthly count
 * - Codeforces: rating with badge color
 * Also: attendance matrix (per-person, all contest dates as columns)
 */

const db = require('../config/db');
const contestAnalytics = require('../services/contestAnalyticsService');

// ─── Codeforces rating → rank + badge color ─────────────────────────────────
function getCodeforcesRank(rating) {
  if (!rating || rating <= 0) return { rank: 'Unrated', color: '#808080', bg: '#f3f4f6' };
  if (rating < 1200) return { rank: 'Newbie',        color: '#808080', bg: '#f3f4f6' };
  if (rating < 1400) return { rank: 'Pupil',         color: '#008000', bg: '#f0fdf4' };
  if (rating < 1600) return { rank: 'Specialist',    color: '#03a89e', bg: '#f0fdfa' };
  if (rating < 1900) return { rank: 'Expert',        color: '#0000ff', bg: '#eff6ff' };
  if (rating < 2100) return { rank: 'Candidate Master', color: '#aa00aa', bg: '#fdf4ff' };
  if (rating < 2300) return { rank: 'Master',        color: '#ff8c00', bg: '#fff7ed' };
  if (rating < 2400) return { rank: 'International Master', color: '#ff8c00', bg: '#fff7ed' };
  if (rating < 2600) return { rank: 'Grandmaster',   color: '#ff0000', bg: '#fef2f2' };
  if (rating < 3000) return { rank: 'International Grandmaster', color: '#ff0000', bg: '#fef2f2' };
  return { rank: 'Legendary Grandmaster', color: '#ff0000', bg: '#fef2f2' };
}

// ─── CodeChef stars → badge color ───────────────────────────────────────────
function getCodeChefStarColor(stars) {
  const map = { '1★': '#808080', '2★': '#1e7d22', '3★': '#3366cc',
                '4★': '#684273', '5★': '#ffbf00', '6★': '#ff7f00', '7★': '#d40000' };
  return map[stars] || '#808080';
}

// ─── Week boundaries (Sun–Sat) for a given date ─────────────────────────────
function getWeekRange(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ─── Month boundaries ───────────────────────────────────────────────────────
function getMonthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end   = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * GET /api/reports/platform-stats
 * Returns per-student platform contest solve stats + Codeforces badge
 */
async function getPlatformStats(req, res) {
  try {
    const { department, section, academicBatch } = req.query;

    // Fetch all active students with their platform profiles
    let sql = `
      SELECT u.id, u.name, u.roll_no, u.department, u.section, u.academic_batch,
             u.leetcode_username, u.codechef_username, u.codeforces_username,
             lp.contest_history  AS lc_history,
             lp.current_rating   AS lc_rating,
             lp.highest_rating   AS lc_best_rating,
             cp.contest_history  AS cc_history,
             cp.current_rating   AS cc_rating,
             cp.stars            AS cc_stars,
             cfp.contest_history AS cf_history,
             cfp.current_rating  AS cf_rating,
             cfp.rank            AS cf_rank
      FROM Users u
      LEFT JOIN LeetCodeProfiles  lp  ON lp.user_id  = u.id
      LEFT JOIN CodeChefProfiles  cp  ON cp.user_id  = u.id
      LEFT JOIN CodeforcesProfiles cfp ON cfp.user_id = u.id
      WHERE u.status = 'active'
    `;
    const params = [];
    if (department)   { sql += ' AND u.department = ?';    params.push(department); }
    if (section)      { sql += ' AND u.section = ?';       params.push(section); }
    if (academicBatch){ sql += ' AND u.academic_batch = ?'; params.push(academicBatch); }
    sql += ' ORDER BY u.roll_no ASC';

    const students = await db.query(sql, params);
    const now = new Date();
    const { start: wStart, end: wEnd } = getWeekRange(now);
    const { start: mStart, end: mEnd } = getMonthRange(now);

    const result = students.map(s => {
      // ── LeetCode ─────────────────────────────────────────────────────────
      const lcHistory = contestAnalytics.parseContestHistory(s.lc_history);
      let lcWeekly = 0, lcBiweekly = 0, lcWeeklyMonth = 0, lcBiweeklyMonth = 0;

      lcHistory.forEach(entry => {
        if (!entry.attended && entry.attended !== undefined) return;
        const slug = (entry.contest?.titleSlug || entry.contestSlug || '').toLowerCase();
        const ts   = entry.contest?.startTime ? new Date(entry.contest.startTime * 1000)
                   : entry.contestDate        ? new Date(entry.contestDate) : null;
        if (!ts || isNaN(ts)) return;
        const isWeekly    = slug.includes('weekly') && !slug.includes('biweekly');
        const isBiweekly  = slug.includes('biweekly');
        const inThisWeek  = ts >= wStart && ts <= wEnd;
        const inThisMonth = ts >= mStart && ts <= mEnd;
        if (isWeekly  && inThisWeek)  lcWeekly++;
        if (isBiweekly && inThisWeek)  lcBiweekly++;
        if (isWeekly  && inThisMonth) lcWeeklyMonth++;
        if (isBiweekly && inThisMonth) lcBiweeklyMonth++;
      });

      // ── CodeChef ──────────────────────────────────────────────────────────
      const ccHistory = contestAnalytics.parseContestHistory(s.cc_history);
      let ccWedWeek = 0, ccWedMonth = 0;

      ccHistory.forEach(entry => {
        const name = (entry.contestName || entry.contest?.title || '').toLowerCase();
        const dateStr = entry.contestDate || entry.contest?.startTime || null;
        if (!dateStr) return;
        const ts = new Date(dateStr);
        if (isNaN(ts)) return;
        // CodeChef Starters = Wednesday contests
        const isWednesday = ts.getDay() === 3;
        const isStarter   = name.includes('starters') || isWednesday;
        const inThisWeek  = ts >= wStart && ts <= wEnd;
        const inThisMonth = ts >= mStart && ts <= mEnd;
        if (isStarter && inThisWeek)  ccWedWeek++;
        if (isStarter && inThisMonth) ccWedMonth++;
      });

      // ── Codeforces ────────────────────────────────────────────────────────
      const cfRating = s.cf_rating ? Number(s.cf_rating) : 0;
      const cfBadge  = getCodeforcesRank(cfRating);
      const cfHistory = contestAnalytics.parseContestHistory(s.cf_history);
      let cfWeek = 0, cfMonth = 0;

      cfHistory.forEach(entry => {
        const ts = entry.ratingUpdateTimeSeconds
          ? new Date(entry.ratingUpdateTimeSeconds * 1000)
          : null;
        if (!ts || isNaN(ts)) return;
        if (ts >= wStart && ts <= wEnd)  cfWeek++;
        if (ts >= mStart && ts <= mEnd) cfMonth++;
      });

      const ccStarColor = getCodeChefStarColor(s.cc_stars);

      return {
        id: s.id,
        name: s.name,
        rollNo: s.roll_no,
        department: s.department,
        section: s.section,
        batch: s.academic_batch,
        leetcode: {
          username: s.leetcode_username || null,
          rating: s.lc_rating ? Number(s.lc_rating) : null,
          bestRating: s.lc_best_rating ? Number(s.lc_best_rating) : null,
          weeklyThisWeek: lcWeekly,
          biweeklyThisWeek: lcBiweekly,
          weeklyThisMonth: lcWeeklyMonth,
          biweeklyThisMonth: lcBiweeklyMonth
        },
        codechef: {
          username: s.codechef_username || null,
          rating: s.cc_rating ? Number(s.cc_rating) : null,
          stars: s.cc_stars || null,
          starColor: ccStarColor,
          wednesdayContestsThisWeek: ccWedWeek,
          wednesdayContestsThisMonth: ccWedMonth
        },
        codeforces: {
          username: s.codeforces_username || null,
          rating: cfRating || null,
          rank: cfBadge.rank,
          rankColor: cfBadge.color,
          rankBg: cfBadge.bg,
          contestsThisWeek: cfWeek,
          contestsThisMonth: cfMonth
        }
      };
    });

    return res.json({
      success: true,
      count: result.length,
      week: { start: wStart.toISOString(), end: wEnd.toISOString() },
      month: { start: mStart.toISOString(), end: mEnd.toISOString() },
      data: result
    });
  } catch (err) {
    console.error('[PlatformStats] Error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * GET /api/reports/attendance-matrix
 * Returns attendance per student × per contest date (all dates as columns)
 * Ready for Excel export where each row = student, each column = contest date
 */
async function getAttendanceMatrix(req, res) {
  try {
    const { department, section, academicBatch, contestType } = req.query;

    // Get all finished contests (sorted by date ascending)
    let contestSql = `
      SELECT c.contest_id, c.title, c.slug, c.contest_type, c.start_time,
             c.contest_status
      FROM Contests c
      WHERE c.start_time <= NOW()
        AND c.contest_status != 'Cancelled'
    `;
    const contestParams = [];
    if (contestType) { contestSql += ' AND c.contest_type = ?'; contestParams.push(contestType); }
    contestSql += ' ORDER BY c.start_time ASC';
    const contests = await db.query(contestSql, contestParams);

    // Get all students
    let studentSql = `
      SELECT u.id, u.name, u.roll_no, u.department, u.section, u.academic_batch,
             u.leetcode_username
      FROM Users u
      WHERE u.status = 'active'
    `;
    const studentParams = [];
    if (department)    { studentSql += ' AND u.department = ?';    studentParams.push(department); }
    if (section)       { studentSql += ' AND u.section = ?';       studentParams.push(section); }
    if (academicBatch) { studentSql += ' AND u.academic_batch = ?'; studentParams.push(academicBatch); }
    studentSql += ' ORDER BY u.roll_no ASC';
    const students = await db.query(studentSql, studentParams);

    if (students.length === 0 || contests.length === 0) {
      return res.json({ success: true, contests: [], students: [], matrix: [] });
    }

    // Get all attendance records for these students and contests
    const studentIds  = students.map(s => s.id);
    const contestIds  = contests.map(c => c.contest_id);

    // Build placeholders safely
    const sPlaceholders = studentIds.map(() => '?').join(',');
    const cPlaceholders = contestIds.map(() => '?').join(',');

    const records = await db.query(
      `SELECT ar.user_id, ar.contest_id, ar.attendance_status
       FROM AttendanceRecords ar
       WHERE ar.user_id IN (${sPlaceholders})
         AND ar.contest_id IN (${cPlaceholders})`,
      [...studentIds, ...contestIds]
    );

    // Build lookup map: userId_contestId → status
    const lookup = new Map();
    records.forEach(r => {
      lookup.set(`${r.user_id}_${r.contest_id}`, r.attendance_status);
    });

    // Build matrix rows
    const matrix = students.map(s => {
      const row = {
        id: s.id,
        rollNo: s.roll_no,
        name: s.name,
        department: s.department,
        section: s.section,
        batch: s.academic_batch,
        leetcodeUsername: s.leetcode_username || '',
        attendance: {}
      };
      contests.forEach(c => {
        const status = lookup.get(`${s.id}_${c.contest_id}`);
        row.attendance[c.contest_id] = status || 'N/A';
      });
      return row;
    });

    return res.json({
      success: true,
      contests: contests.map(c => ({
        id: c.contest_id,
        title: c.title,
        slug: c.slug,
        type: c.contest_type,
        date: c.start_time,
        status: c.contest_status
      })),
      students: students.length,
      matrix
    });
  } catch (err) {
    console.error('[AttendanceMatrix] Error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getPlatformStats, getAttendanceMatrix };
