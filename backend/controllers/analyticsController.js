/**
 * analyticsController.js (UPDATED)
 * ==================================
 * Delegates all analytics to PlatformAnalyticsService, ContestAnalyticsService,
 * and DashboardMetricsService. No independent calculations.
 */

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
  try {
    const platforms = platform ? [platform] : ['leetcode', 'codechef', 'codeforces'];
    const result = {};
    for (const p of platforms) {
      result[p] = await contestAnalytics.getRatingHistory(Number(studentId), p);
    }
    return res.json({ success: true, ratingHistory: result });
  } catch (error) {
    console.error('[AnalyticsController] Error fetching rating history:', error);
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

module.exports = {
  getStudentAnalytics,
  getLeaderboards,
  getPortalSummary,
  getRatingDistribution,
  getStudentRatingHistory,
  getStudentContestHistory
};
