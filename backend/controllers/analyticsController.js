/**
 * analyticsController.js (UPDATED)
 * ==================================
 * Delegates all analytics to PlatformAnalyticsService, ContestAnalyticsService,
 * and DashboardMetricsService. No independent calculations.
 */

const db = require('../config/db');
const platformAnalytics = require('../services/platformAnalyticsService');
const dashboardMetrics = require('../services/dashboardMetricsService');
const contestAnalytics = require('../services/contestAnalyticsService');
const attendanceService = require('../services/attendanceService');

/**
 * Get detailed analytics for a single student (attendance + platform profiles + contest history).
 */
async function getStudentAnalytics(req, res) {
  const { studentId } = req.params;
  try {
    // Unified platform profile
    const profile = await platformAnalytics.getUnifiedStudentProfile(Number(studentId));
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    // Attendance history
    const { history, metrics } = await attendanceService.getStudentAttendance(Number(studentId));

    // Contest history (platform-specific, normalized)
    const contestHistory = await contestAnalytics.getStudentContestHistory(Number(studentId));

    // LeetCode rating history
    const lcRatingHistory = await contestAnalytics.getRatingHistory(Number(studentId), 'leetcode');
    const ccRatingHistory = await contestAnalytics.getRatingHistory(Number(studentId), 'codechef');
    const cfRatingHistory = await contestAnalytics.getRatingHistory(Number(studentId), 'codeforces');

    return res.json({
      success: true,
      student: profile.student,
      profiles: profile.profiles,
      overallScore: profile.overallScore,
      totalProblemsSolved: profile.totalProblemsSolved,
      metrics: {
        ...metrics,
        currentRating: profile.profiles.leetcode?.rating || 0,
        bestRating: profile.profiles.leetcode?.maxRating || 0,
        bestRank: profile.profiles.leetcode?.globalRanking || null,
        codechefRating: profile.profiles.codechef?.rating || null,
        codechefHighestRating: profile.profiles.codechef?.maxRating || null,
        codechefStars: profile.profiles.codechef?.stars || null,
        codeforcesRating: profile.profiles.codeforces?.rating || null,
        codeforcesRank: profile.profiles.codeforces?.rank || null,
        ratingGrowth: (profile.profiles.leetcode?.rating || 0) - 1500
      },
      history,
      contestHistory,
      ratingHistory: {
        leetcode: lcRatingHistory,
        codechef: ccRatingHistory,
        codeforces: cfRatingHistory
      }
    });
  } catch (error) {
    console.error('[AnalyticsController] Error fetching student analytics:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve student analytics' });
  }
}

/**
 * Get leaderboards with multi-sort support.
 */
async function getLeaderboards(req, res) {
  const { department, academicBatch, section, sortBy, limit } = req.query;
  try {
    const data = await platformAnalytics.getLeaderboards({
      department, section, academicBatch,
      sortBy: sortBy || 'rating',
      limit: limit ? Number(limit) : 100
    });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error('[AnalyticsController] Error generating leaderboards:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate leaderboards' });
  }
}

/**
 * Get portal-wide summary statistics.
 */
async function getPortalSummary(req, res) {
  try {
    const data = await dashboardMetrics.getPortalSummary();
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error('[AnalyticsController] Error fetching portal summary:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve portal summary analytics' });
  }
}

/**
 * Get rating distribution histogram.
 */
async function getRatingDistribution(req, res) {
  try {
    const data = await platformAnalytics.getRatingDistribution();
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error('[AnalyticsController] Error fetching rating distribution:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve rating distribution' });
  }
}

/**
 * Get platform-specific rating history for a student.
 */
async function getStudentRatingHistory(req, res) {
  const { studentId } = req.params;
  const { platform } = req.query;
  const logger = require('../utils/logger');
  try {
    const platforms = platform ? [platform] : ['leetcode', 'codechef', 'codeforces'];
    const result = {};
    await Promise.allSettled(platforms.map(async (p) => {
      try {
        result[p] = await contestAnalytics.getRatingHistory(Number(studentId), p);
      } catch (err) {
        logger.error(`[Rating History Failure] Platform: ${p} | Error:`, err.message);
        result[p] = [];
      }
    }));
    return res.json({ success: true, ratingHistory: result });
  } catch (error) {
    logger.error('[AnalyticsController] Error fetching rating history:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve rating history' });
  }
}

/**
 * Get combined contest history for a student (all platforms).
 */
async function getStudentContestHistory(req, res) {
  const { studentId } = req.params;
  try {
    const history = await contestAnalytics.getStudentContestHistory(Number(studentId));
    return res.json({ success: true, ...history });
  } catch (error) {
    console.error('[AnalyticsController] Error fetching contest history:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve contest history' });
  }
}

// Relocated getDashboardStats method for warning alerts in Navbar
async function getDashboardStats(req, res) {
  try {
    const serviceStats = await dashboardMetrics.getDashboardStats();

    // Fetch lowAttendanceStudents and studentsWithoutProfiles directly from DB as they are alert-specific
    const lowAttendanceStudents = await db.query(
      `SELECT u.id, u.name, u.roll_no as register_number, u.department, u.section,
              COUNT(DISTINCT ar.contest_id) as total_contests,
              COUNT(DISTINCT CASE WHEN ar.attendance_status = 'PRESENT' THEN ar.contest_id END) as present_count,
              ROUND(IFNULL(COUNT(DISTINCT CASE WHEN ar.attendance_status = 'PRESENT' THEN ar.contest_id END) / 
                    NULLIF(COUNT(DISTINCT ar.contest_id), 0) * 100, 0)) as attendance_percentage
       FROM Users u
       LEFT JOIN AttendanceRecords ar ON ar.user_id = u.id
       LEFT JOIN Contests c ON ar.contest_id = c.contest_id 
         AND c.contest_status = 'Rated'
         AND c.start_time >= u.academic_start_date 
         AND c.start_time <= u.academic_end_date
         -- Exclude test/mock/dummy/retry/stale/crashed/regression/internal contests
         AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
         AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
         AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
         AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
         AND c.slug NOT LIKE '%internal-%'
       WHERE u.status = 'active'
       GROUP BY u.id, u.name, u.roll_no, u.department, u.section
       HAVING total_contests >= 3 AND attendance_percentage < 30
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
    console.error('[AnalyticsController] Error fetching dashboard stats:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve dashboard statistics: ' + error.message });
  }
}

module.exports = {
  getStudentAnalytics,
  getLeaderboards,
  getPortalSummary,
  getRatingDistribution,
  getStudentRatingHistory,
  getStudentContestHistory,
  getDashboardStats
};
