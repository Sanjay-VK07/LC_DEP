/**
 * DashboardMetricsService
 * =======================
 * Aggregated dashboard statistics.
 * All dashboard metric calculations are centralised here.
 * Uses AnalyticsCacheService for TTL-based caching.
 */

const db = require('../config/db');
const cache = require('./analyticsCacheService');
const contestAnalytics = require('./contestAnalyticsService');

/**
 * Compute overall score for a student based on platform ratings.
 */
function computeOverallScore(lcRating, ccRating, cfRating, lcSolved, ccSolved, cfSolved, hrSolved) {
  const weights = { lc: 0.35, cc: 0.2, cf: 0.25, hr: 0.2 };
  let score = 0;
  if (lcRating > 0) score += Math.min(lcRating / 2500, 1) * 60 * weights.lc;
  if (ccRating > 0) score += Math.min(ccRating / 2000, 1) * 60 * weights.cc;
  if (cfRating > 0) score += Math.min(cfRating / 2500, 1) * 60 * weights.cf;
  const totalSolved = (lcSolved || 0) + (ccSolved || 0) + (cfSolved || 0) + (hrSolved || 0);
  score += Math.min(totalSolved / 400, 1) * 25;
  return Math.round(score);
}

/**
 * Get all dashboard statistics.
 * Results are cached for 10 minutes.
 */
async function getDashboardStats() {
  return cache.getOrCompute(cache.KEYS.DASHBOARD_STATS, async () => {
    // 1. Total active students
    const [totalStudentsRow] = await db.query(
      "SELECT COUNT(*) as count FROM Users WHERE status = 'active'"
    );
    const totalStudents = Number(totalStudentsRow?.count || 0);

    // 2. Contest breakdown
    const contestStats = await contestAnalytics.getContestSummaryStats();

    // 3. Overall attendance across all rated, ended, production contests within academic dates
    //    Using COUNT(DISTINCT user_id+contest_id) to avoid any double-counting.
    const [attendanceRow] = await db.query(
      `SELECT 
         COUNT(DISTINCT CONCAT(ar.user_id, '-', ar.contest_id)) as total_regs,
         SUM(CASE WHEN ar.attendance_status = 'PRESENT' THEN 1 ELSE 0 END) as total_parts
       FROM AttendanceRecords ar
       JOIN Contests c ON ar.contest_id = c.contest_id
       JOIN Users u ON ar.user_id = u.id
       WHERE c.contest_status = 'Rated'
         AND u.status = 'active'
         AND c.start_time >= u.academic_start_date
         AND c.start_time <= u.academic_end_date
         AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND <= NOW()
         AND COALESCE(c.is_test, 0) = 0
         AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
         AND c.slug NOT LIKE 'mock-%' AND c.slug NOT LIKE '%mock-%'
         AND c.slug NOT LIKE 'dummy-%' AND c.slug NOT LIKE '%dummy-%'
         AND c.slug NOT LIKE 'retry-%' AND c.slug NOT LIKE 'stale-%'
         AND c.slug NOT LIKE 'crashed-%' AND c.slug NOT LIKE 'regression-%'
         AND c.slug NOT LIKE 'internal-%' AND c.slug NOT LIKE 'debug-%'
         AND c.slug NOT LIKE 'demo-%'`
    );
    const totalRegs = Number(attendanceRow?.total_regs || 0);
    const totalParts = Number(attendanceRow?.total_parts || 0);
    const overallAttendance = totalRegs > 0 ? Math.round((totalParts / totalRegs) * 100) : 0;

    // 4. Platform profile data
    const users = await db.query(
      `SELECT u.id, u.name, u.roll_no, u.department, u.section,
              u.leetcode_username, u.codechef_username, u.codeforces_username, u.hackerrank_username,
              ROUND(IFNULL(lp.current_rating, 0)) as lc_rating,
              IFNULL(lp.problems_solved, 0) as lc_solved,
              ROUND(IFNULL(cp.current_rating, 0)) as cc_rating,
              IFNULL(cp.problems_solved, 0) as cc_solved,
              ROUND(IFNULL(cfp.current_rating, 0)) as cf_rating,
              IFNULL(cfp.problems_solved, 0) as cf_solved,
              IFNULL(hrp.problems_solved, 0) as hr_solved,
              IFNULL(hrp.stars, 0) as hr_stars
       FROM Users u
       LEFT JOIN LeetCodeProfiles lp ON lp.user_id = u.id
       LEFT JOIN CodeChefProfiles cp ON cp.user_id = u.id
       LEFT JOIN CodeforcesProfiles cfp ON cfp.user_id = u.id
       LEFT JOIN HackerRankProfiles hrp ON hrp.user_id = u.id
       WHERE u.status = 'active'`
    );

    // 5. Compute derived metrics
    const activeCodingProfiles = users.filter(u =>
      [u.leetcode_username, u.codechef_username, u.codeforces_username, u.hackerrank_username]
        .some(v => v && String(v).trim())
    ).length;

    const platformConnections = users.reduce((sum, u) =>
      sum + [u.leetcode_username, u.codechef_username, u.codeforces_username, u.hackerrank_username]
        .filter(v => v && String(v).trim()).length, 0
    );

    const ratingValues = users.flatMap(u => [
      Number(u.lc_rating) > 0 ? Number(u.lc_rating) : null,
      Number(u.cc_rating) > 0 ? Number(u.cc_rating) : null,
      Number(u.cf_rating) > 0 ? Number(u.cf_rating) : null
    ].filter(v => v !== null));

    const averageCodingRating = ratingValues.length > 0
      ? Math.round(ratingValues.reduce((s, v) => s + v, 0) / ratingValues.length)
      : 0;

    const ratedStudents = users.filter(u =>
      [u.lc_rating, u.cc_rating, u.cf_rating].some(v => Number(v) > 0)
    ).length;

    // Top 5 performers by overall score
    const userScores = users.map(u => ({
      id: u.id,
      name: u.name,
      roll_no: u.roll_no,
      department: u.department,
      section: u.section,
      leetcode_username: u.leetcode_username,
      overall_score: computeOverallScore(
        Number(u.lc_rating), Number(u.cc_rating), Number(u.cf_rating),
        Number(u.lc_solved), Number(u.cc_solved), Number(u.cf_solved), Number(u.hr_solved)
      ),
      lc_rating: u.lc_rating,
      cc_rating: u.cc_rating,
      cf_rating: u.cf_rating
    })).sort((a, b) => b.overall_score - a.overall_score);

    const topPerformers = userScores.slice(0, 5);

    // Platform adoption percentages
    const platformAdoption = {
      leetcode: totalStudents > 0 ? Math.round((users.filter(u => u.leetcode_username).length / totalStudents) * 100) : 0,
      codechef: totalStudents > 0 ? Math.round((users.filter(u => u.codechef_username).length / totalStudents) * 100) : 0,
      codeforces: totalStudents > 0 ? Math.round((users.filter(u => u.codeforces_username).length / totalStudents) * 100) : 0,
      hackerrank: totalStudents > 0 ? Math.round((users.filter(u => u.hackerrank_username).length / totalStudents) * 100) : 0
    };

    // 6. Weekly attendance trend
    const weeklyTrend = await contestAnalytics.getWeeklyTrend(8);

    // 7. Sync logs
    const recentSync = await db.query(
      'SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 5'
    );

    // 8. Upcoming contests
    const upcomingContests = await db.query(
      `SELECT contest_id, title, slug, start_time, contest_type, contest_status
       FROM Contests WHERE start_time > NOW()
       ORDER BY start_time ASC LIMIT 5`
    );

    // 9. Department breakdown
    const departmentStats = await db.query(
      `SELECT u.department,
              COUNT(DISTINCT u.id) as student_count,
              ROUND(AVG(IFNULL(lp.current_rating, 0))) as avg_lc_rating
       FROM Users u
       LEFT JOIN LeetCodeProfiles lp ON lp.user_id = u.id
       WHERE u.status = 'active'
       GROUP BY u.department
       ORDER BY student_count DESC`
    );

    return {
      totalStudents,
      activeCodingProfiles,
      platformConnections,
      averageCodingRating,
      ratedStudents,
      unratedStudents: totalStudents - ratedStudents,
      overallAttendance,
      totalRegs,
      totalParts,
      contestStats,
      topPerformers,
      platformAdoption,
      weeklyTrend,
      recentSync,
      upcomingContests,
      departmentStats
    };
  }, 10 * 60 * 1000); // 10 min TTL
}

/**
 * Get portal-wide summary statistics.
 */
async function getPortalSummary() {
  return cache.getOrCompute(cache.KEYS.PORTAL_SUMMARY, async () => {
    const [globalStats] = await db.query(
      `SELECT
         IFNULL(ROUND(AVG(lp.current_rating)), 0) as avg_lc_rating,
         IFNULL(ROUND(MAX(lp.highest_rating)), 0) as max_lc_rating,
         IFNULL(ROUND(AVG(cp.current_rating)), 0) as avg_cc_rating,
         IFNULL(ROUND(MAX(cp.highest_rating)), 0) as max_cc_rating,
         IFNULL(ROUND(AVG(cfp.current_rating)), 0) as avg_cf_rating,
         IFNULL(ROUND(MAX(cfp.highest_rating)), 0) as max_cf_rating,
         IFNULL(MIN(lp.global_ranking), 0) as best_lc_rank
       FROM Users u
       LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
       LEFT JOIN CodeChefProfiles cp ON u.id = cp.user_id
       LEFT JOIN CodeforcesProfiles cfp ON u.id = cfp.user_id
       WHERE u.status = 'active'`
    );

    // Compute avg attendance using a JOIN-based approach instead of correlated subqueries
    const [avgAttRow] = await db.query(
      `SELECT IFNULL(ROUND(AVG(student_att.pct)), 0) as avg_attendance
       FROM (
         SELECT ar.user_id,
           IFNULL(SUM(CASE WHEN ar.attendance_status = 'PRESENT' THEN 1 ELSE 0 END) /
             NULLIF(SUM(CASE WHEN ar.attendance_status IN ('PRESENT','ABSENT') THEN 1 ELSE 0 END), 0) * 100, 0) as pct
         FROM AttendanceRecords ar
         JOIN Contests c ON ar.contest_id = c.contest_id
         JOIN Users u ON ar.user_id = u.id
         WHERE c.contest_status = 'Rated' AND u.status = 'active'
         GROUP BY ar.user_id
       ) student_att`
    );

    const batchStats = await db.query(
      `SELECT u.academic_batch as batch,
              COUNT(DISTINCT u.id) as total_students,
              IFNULL(ROUND(AVG(lp.current_rating)), 0) as avg_lc_rating,
              IFNULL(ROUND(AVG(cp.current_rating)), 0) as avg_cc_rating
       FROM Users u
       LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
       LEFT JOIN CodeChefProfiles cp ON u.id = cp.user_id
       WHERE u.status = 'active'
       GROUP BY u.academic_batch
       ORDER BY u.academic_batch DESC`
    );

    const sectionStats = await db.query(
      `SELECT u.department, u.section,
              CONCAT(u.department, ' - ', u.section) as label,
              COUNT(DISTINCT u.id) as total_students,
              IFNULL(ROUND(AVG(lp.current_rating)), 0) as avg_lc_rating
       FROM Users u
       LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
       WHERE u.status = 'active'
       GROUP BY u.department, u.section
       ORDER BY u.department ASC, u.section ASC`
    );

    return {
      globalStats: {
        ...(globalStats || {}),
        avg_attendance: Number(avgAttRow?.avg_attendance || 0)
      },
      batchStats,
      sectionStats
    };
  }, 10 * 60 * 1000);
}

module.exports = {
  getDashboardStats,
  getPortalSummary,
  computeOverallScore
};
