const legacyAttendanceService = require('../attendanceService');

/**
 * AnalyticsService
 * Responsible ONLY for analytics charts, trends, batch comparisons, and rankings.
 */
class AnalyticsService {
  /**
   * Fetches platform analytics visualizations and metrics summary.
   */
  async getPlatformAnalytics(platform, studentId = 'all', filters = {}) {
    const data = await legacyAttendanceService.getPlatformAnalytics(platform, studentId, filters);
    
    return {
      metrics: data.metrics || { eligible: 0, attended: 0, missed: 0, rate: 0.0, ongoing: 0 },
      contests: data.contests || [],
      monthlyTrendData: data.monthlyTrendData || [],
      semesterAnalyticsData: data.semesterAnalyticsData || [],
      batchComparisonData: data.batchComparisonData || [],
      studentSummaries: data.studentSummaries || [],
      platformRanking: data.platformRanking || null
    };
  }
}

module.exports = new AnalyticsService();
