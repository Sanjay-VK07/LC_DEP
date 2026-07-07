/**
 * reportController.js (UPDATED)
 * ================================
 * Delegates all metric calculations to centralized services.
 * Returns the exact same response shape as the original, augmented
 * with new fields from DashboardMetricsService so the Dashboard renders correctly.
 */

const db = require('../config/db');
const dashboardMetrics = require('../services/dashboardMetricsService');
const attendanceService = require('../services/attendanceService');
const contestAnalytics = require('../services/contestAnalyticsService');

// 1. Get Faculty Dashboard Statistics
// Returns original shape + extended fields for backward compatibility
async function getDashboardStats(req, res) {
  try {
    const serviceStats = await dashboardMetrics.getDashboardStats();

    // Fetch lowAttendanceStudents and studentsWithoutProfiles directly from DB as they are alert-specific
    const lowAttendanceStudents = await db.query(
      `SELECT u.id, u.name, u.roll_no as register_number, u.department, u.section,
              (SELECT COUNT(*) FROM Registrations r WHERE r.user_id = u.id) as total_contests,
              (SELECT COUNT(*) FROM ParticipationLogs p WHERE p.user_id = u.id) as present_count,
              ROUND((SELECT COUNT(*) FROM ParticipationLogs p WHERE p.user_id = u.id) /
                NULLIF((SELECT COUNT(*) FROM Registrations r WHERE r.user_id = u.id), 0) * 100) as attendance_percentage
       FROM Users u
       WHERE u.status = 'active'
         AND (SELECT COUNT(*) FROM Registrations r WHERE r.user_id = u.id) >= 3
         AND (SELECT COUNT(*) FROM ParticipationLogs p WHERE p.user_id = u.id) /
             NULLIF((SELECT COUNT(*) FROM Registrations r WHERE r.user_id = u.id), 0) * 100 < 30
       ORDER BY attendance_percentage ASC
       LIMIT 10`
    );

    const studentsWithoutProfiles = await db.query(
      `SELECT u.id, u.name, u.roll_no as register_number, u.department
       FROM Users u
       WHERE u.status = 'active'
         AND u.leetcode_username IS NULL
         AND u.codechef_username IS NULL
         AND u.codeforces_username IS NULL
         AND u.hackerrank_username IS NULL
       LIMIT 5`
    );

    const platformOverview = [
      {
        platform: 'leetcode',
        label: 'LeetCode',
        linkedUsers: Number(serviceStats.platformAdoption?.leetcode ? Math.round(serviceStats.totalStudents * serviceStats.platformAdoption.leetcode / 100) : 0),
        avgRating: serviceStats.averageCodingRating,
        avgProblems: 0,
        participationCount: serviceStats.totalParts || 0
      },
      {
        platform: 'codechef',
        label: 'CodeChef',
        linkedUsers: Number(serviceStats.platformAdoption?.codechef ? Math.round(serviceStats.totalStudents * serviceStats.platformAdoption.codechef / 100) : 0),
        avgRating: 0,
        avgProblems: 0,
        participationCount: 0
      },
      {
        platform: 'codeforces',
        label: 'Codeforces',
        linkedUsers: Number(serviceStats.platformAdoption?.codeforces ? Math.round(serviceStats.totalStudents * serviceStats.platformAdoption.codeforces / 100) : 0),
        avgRating: 0,
        avgProblems: 0,
        participationCount: 0
      },
      {
        platform: 'hackerrank',
        label: 'HackerRank',
        linkedUsers: Number(serviceStats.platformAdoption?.hackerrank ? Math.round(serviceStats.totalStudents * serviceStats.platformAdoption.hackerrank / 100) : 0),
        avgRating: 0,
        avgProblems: 0,
        participationCount: 0
      }
    ];

    const formattedDepartmentStats = (serviceStats.departmentStats || []).map(d => ({
      department: d.department,
      totalStudents: Number(d.student_count || 0),
      total_students: Number(d.student_count || 0),
      average_rating: Number(d.avg_lc_rating || 0),
      avg_lc_rating: Number(d.avg_lc_rating || 0),
      attendancePercentage: 0,
      attendance_percentage: 0
    }));

    return res.json({
      success: true,
      // ---- Original shape (required for backward compatibility) ----
      stats: {
        totalStudents: serviceStats.totalStudents,
        totalActiveStudents: serviceStats.totalStudents,
        totalContests: Number(serviceStats.contestStats?.total || 0),
        ratedContests: Number(serviceStats.contestStats?.rated || 0),
        unratedContests: Number(serviceStats.contestStats?.unrated || 0),
        cancelledContests: Number(serviceStats.contestStats?.cancelled || 0),
        weeklyContests: Number(serviceStats.contestStats?.weekly || 0),
        biweeklyContests: Number(serviceStats.contestStats?.biweekly || 0),
        overallAttendance: serviceStats.overallAttendance,
        averageRating: serviceStats.averageCodingRating,
        recentlySynced: serviceStats.recentSync?.[0] ? {
          time: serviceStats.recentSync[0].completed_at,
          contests: serviceStats.recentSync[0].contests_synced,
          students: serviceStats.recentSync[0].students_processed
        } : null,
        activeCodingProfiles: serviceStats.activeCodingProfiles,
        ratedStudents: serviceStats.ratedStudents,
        unratedStudents: serviceStats.unratedStudents,
        platformConnections: serviceStats.platformConnections,
        overallCodingScore: serviceStats.averageCodingRating,
        averageProblemsSolved: 0
      },
      departmentStats: formattedDepartmentStats,
      weeklyTrend: serviceStats.weeklyTrend || [],
      topStudents: serviceStats.topPerformers || [],
      alerts: {
        missingUploads: [],
        lowAttendanceStudents,
        recentContests: serviceStats.upcomingContests || [],
        invalidPlatformUsernames: [],
        studentsWithoutProfiles,
        profilesNeedingVerification: [],
        failedPlatformSynchronizations: []
      },
      // ---- New fields (used by normalized code) ----
      totalStudents: serviceStats.totalStudents,
      activeCodingProfiles: serviceStats.activeCodingProfiles,
      averageCodingRating: serviceStats.averageCodingRating,
      ratedStudents: serviceStats.ratedStudents,
      unratedStudents: serviceStats.unratedStudents,
      platformConnections: serviceStats.platformConnections,
      overallAttendance: serviceStats.overallAttendance,
      totalRegs: serviceStats.totalRegs,
      totalParts: serviceStats.totalParts,
      platformAdoption: serviceStats.platformAdoption,
      platformOverview,
      topPerformers: serviceStats.topPerformers || [],
      recentSync: serviceStats.recentSync || [],
      upcomingContests: serviceStats.upcomingContests || []
    });
  } catch (error) {
    console.error('[ReportController] Error fetching dashboard stats:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve dashboard statistics: ' + error.message });
  }
}

// 2. Get Per-Contest Attendance Report
async function getContestsReport(req, res) {
  const { type, startDate, endDate, batch } = req.query;
  try {
    let sql = '';
    let params = [];

    if (batch) {
      sql = `
        SELECT c.title as name, c.slug as contest_slug, c.contest_status, c.start_time as date, c.duration,
               (SELECT COUNT(*) FROM Users WHERE status = 'active' AND academic_batch = ?) as total_students,
               (SELECT COUNT(*) FROM ParticipationLogs p JOIN Users u ON p.user_id = u.id WHERE p.contest_id = c.contest_id AND u.academic_batch = ?) as present_count,
               (SELECT COUNT(*) FROM Registrations r JOIN Users u ON r.user_id = u.id WHERE r.contest_id = c.contest_id AND u.academic_batch = ?) -
               (SELECT COUNT(*) FROM ParticipationLogs p JOIN Users u ON p.user_id = u.id WHERE p.contest_id = c.contest_id AND u.academic_batch = ?) as absent_count,
               0 as not_applicable_count,
               IFNULL(ROUND(
                 (SELECT COUNT(*) FROM ParticipationLogs p JOIN Users u ON p.user_id = u.id WHERE p.contest_id = c.contest_id AND u.academic_batch = ?) /
                 NULLIF((SELECT COUNT(*) FROM Registrations r JOIN Users u ON r.user_id = u.id WHERE r.contest_id = c.contest_id AND u.academic_batch = ?), 0) * 100
               ), 0) as attendance_percentage
        FROM Contests c
        WHERE c.contest_status != 'Cancelled'
        ORDER BY c.start_time DESC
      `;
      params = [batch, batch, batch, batch, batch, batch];
    } else {
      sql = `
        SELECT c.contest_id, c.title as name, c.slug as contest_slug, c.contest_status, c.start_time as date, c.duration,
               (SELECT COUNT(*) FROM Users WHERE status = 'active') as total_students,
               (SELECT COUNT(*) FROM ParticipationLogs p WHERE p.contest_id = c.contest_id) as present_count,
               (SELECT COUNT(*) FROM Registrations r WHERE r.contest_id = c.contest_id) -
               (SELECT COUNT(*) FROM ParticipationLogs p WHERE p.contest_id = c.contest_id) as absent_count,
               0 as not_applicable_count,
               IFNULL(ROUND(
                 (SELECT COUNT(*) FROM ParticipationLogs p WHERE p.contest_id = c.contest_id) /
                 NULLIF((SELECT COUNT(*) FROM Registrations r WHERE r.contest_id = c.contest_id), 0) * 100
               ), 0) as attendance_percentage
        FROM Contests c
        WHERE 1=1
      `;
      if (type) { sql += ' AND c.contest_type = ?'; params.push(type); }
      if (startDate) { sql += ' AND c.start_time >= ?'; params.push(startDate); }
      if (endDate) { sql += ' AND c.start_time <= ?'; params.push(endDate); }
      sql += ' ORDER BY c.start_time DESC';
    }

    const data = await db.query(sql, params);
    return res.json({ success: true, count: data.length, data });
  } catch (error) {
    console.error('[ReportController] Error fetching contests report:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve contests report' });
  }
}

// 3. Get All Students Report with Attendance
async function getStudentsReport(req, res) {
  const { department, section, academicBatch, minAttendance, maxAttendance } = req.query;
  try {
    let data = await attendanceService.getBatchAttendanceSummary({ department, section, academicBatch });
    if (minAttendance !== undefined) data = data.filter(s => s.attendance_percentage >= Number(minAttendance));
    if (maxAttendance !== undefined) data = data.filter(s => s.attendance_percentage <= Number(maxAttendance));
    return res.json({ success: true, count: data.length, data });
  } catch (error) {
    console.error('[ReportController] Error fetching students report:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve students report' });
  }
}

// 4. Get Department Report
async function getDepartmentReport(req, res) {
  try {
    const stats = await db.query(
      `SELECT u.department,
              COUNT(DISTINCT u.id) as total_students,
              IFNULL(SUM(
                (SELECT COUNT(*) FROM Registrations r JOIN Contests c ON r.contest_id = c.contest_id
                 WHERE r.user_id = u.id AND c.contest_status = 'Rated'
                   AND c.start_time + INTERVAL IFNULL(c.duration,5400) SECOND <= NOW())
              ), 0) as total_records,
              IFNULL(SUM(
                (SELECT COUNT(*) FROM ParticipationLogs p JOIN Contests c ON p.contest_id = c.contest_id
                 WHERE p.user_id = u.id AND c.contest_status = 'Rated'
                   AND c.start_time + INTERVAL IFNULL(c.duration,5400) SECOND <= NOW())
              ), 0) as present_count,
              IFNULL(ROUND(AVG(lp.current_rating)), 0) as average_rating,
              IFNULL(ROUND(MAX(lp.highest_rating)), 0) as peak_rating
       FROM Users u
       LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
       WHERE u.status = 'active'
       GROUP BY u.department
       ORDER BY present_count DESC`
    );
    const result = stats.map(s => {
      const total = Number(s.total_records);
      const present = Number(s.present_count);
      return { ...s, absent_count: Math.max(0, total - present), attendance_percentage: total > 0 ? Math.round((present / total) * 100) : 0 };
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[ReportController] Error fetching department report:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve department report' });
  }
}

// 5. Get Section Report
async function getSectionReport(req, res) {
  const { department } = req.query;
  try {
    let sql = `
      SELECT u.department, u.section,
             CONCAT(u.department, ' - ', u.section) as section_label,
             COUNT(DISTINCT u.id) as total_students,
             IFNULL(SUM(
               (SELECT COUNT(*) FROM Registrations r JOIN Contests c ON r.contest_id = c.contest_id
                WHERE r.user_id = u.id AND c.contest_status = 'Rated'
                  AND c.start_time + INTERVAL IFNULL(c.duration,5400) SECOND <= NOW())
             ), 0) as total_records,
             IFNULL(SUM(
               (SELECT COUNT(*) FROM ParticipationLogs p JOIN Contests c ON p.contest_id = c.contest_id
                WHERE p.user_id = u.id AND c.contest_status = 'Rated'
                  AND c.start_time + INTERVAL IFNULL(c.duration,5400) SECOND <= NOW())
             ), 0) as present_count,
             IFNULL(ROUND(AVG(lp.current_rating)), 0) as average_rating
      FROM Users u
      LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
      WHERE u.status = 'active'
    `;
    const params = [];
    if (department) { sql += ' AND u.department = ?'; params.push(department); }
    sql += ' GROUP BY u.department, u.section ORDER BY u.department, u.section';
    const stats = await db.query(sql, params);
    const result = stats.map(s => {
      const total = Number(s.total_records);
      const present = Number(s.present_count);
      return { ...s, absent_count: Math.max(0, total - present), attendance_percentage: total > 0 ? Math.round((present / total) * 100) : 0 };
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[ReportController] Error fetching section report:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve section report' });
  }
}

// 6. Get Attendance Heatmap
async function getAttendanceHeatmap(req, res) {
  const { year, type } = req.query;
  try {
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();
    let sql = `
      SELECT DATE(c.start_time) as date,
             COUNT(DISTINCT p.user_id) as participant_count,
             COUNT(DISTINCT r.user_id) as registered_count,
             c.contest_type, c.contest_status
      FROM Contests c
      LEFT JOIN ParticipationLogs p ON p.contest_id = c.contest_id
      LEFT JOIN Registrations r ON r.contest_id = c.contest_id
      WHERE YEAR(c.start_time) = ? AND c.contest_status != 'Cancelled'
    `;
    const params = [targetYear];
    if (type) { sql += ' AND c.contest_type = ?'; params.push(type); }
    sql += ' GROUP BY c.contest_id ORDER BY c.start_time ASC';
    const rows = await db.query(sql, params);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[ReportController] Error fetching heatmap:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve attendance heatmap' });
  }
}

// 7. Get Attendance Log (paginated)
async function getAttendanceLog(req, res) {
  const { contestId, userId, status, page = 1, limit = 50 } = req.query;
  try {
    let sql = `
      SELECT ar.id, ar.user_id, ar.contest_id, ar.attendance_status, ar.attendance_source,
             ar.remarks, ar.last_updated,
             u.name, u.roll_no, u.department, u.section,
             c.title as contest_name, c.start_time as contest_date, c.contest_type
      FROM AttendanceRecords ar
      JOIN Users u ON u.id = ar.user_id
      JOIN Contests c ON c.contest_id = ar.contest_id
      WHERE 1=1
    `;
    const params = [];
    if (contestId) { sql += ' AND ar.contest_id = ?'; params.push(contestId); }
    if (userId) { sql += ' AND ar.user_id = ?'; params.push(userId); }
    if (status) { sql += ' AND ar.attendance_status = ?'; params.push(status); }
    const safeLimit = Number.parseInt(limit, 10) || 50;
    const safeOffset = (Number.parseInt(page, 10) - 1) * safeLimit;
    if (!Number.isInteger(safeLimit) || safeLimit <= 0 || !Number.isInteger(safeOffset) || safeOffset < 0) {
      throw new Error("Invalid limit or offset");
    }

    sql += ` ORDER BY ar.last_updated DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;
    const rows = await db.query(sql, params);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[ReportController] Error fetching attendance log:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve attendance log' });
  }
}

// 8. Faculty Summary (new)
async function getFacultySummary(req, res) {
  try {
    const [ratingDist] = await db.query(
      `SELECT
         SUM(CASE WHEN lp.current_rating < 1400 THEN 1 ELSE 0 END) as beginner,
         SUM(CASE WHEN lp.current_rating >= 1400 AND lp.current_rating < 1600 THEN 1 ELSE 0 END) as intermediate,
         SUM(CASE WHEN lp.current_rating >= 1600 AND lp.current_rating < 1800 THEN 1 ELSE 0 END) as advanced,
         SUM(CASE WHEN lp.current_rating >= 1800 THEN 1 ELSE 0 END) as expert
       FROM LeetCodeProfiles lp
       JOIN Users u ON u.id = lp.user_id
       WHERE u.status = 'active' AND lp.current_rating > 0`
    );
    return res.json({
      success: true,
      ratingDistribution: ratingDist || { beginner: 0, intermediate: 0, advanced: 0, expert: 0 }
    });
  } catch (error) {
    console.error('[ReportController] Error fetching faculty summary:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve faculty summary' });
  }
}

module.exports = {
  getDashboardStats,
  getContestsReport,
  getStudentsReport,
  getDepartmentReport,
  getSectionReport,
  getAttendanceHeatmap,
  getAttendanceLog,
  getFacultySummary
};
