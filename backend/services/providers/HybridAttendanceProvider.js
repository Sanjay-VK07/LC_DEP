const AttendanceProvider = require('./AttendanceProvider');
const RankingPageAttendanceProvider = require('./RankingPageAttendanceProvider');
const GraphQLAttendanceProvider = require('./GraphQLAttendanceProvider');

/**
 * Resolves attendance from the live ranking-page leaderboard (fast, reflects
 * real contest results immediately). Fails fast on any scrape error instead
 * of falling back to GraphQL userContestRankingHistory, which requires a
 * slow per-student scan (minutes, not seconds) and can lag real results by
 * a day or more.
 */
class HybridAttendanceProvider extends AttendanceProvider {
  constructor() {
    super('HYBRID');
  }

  async resolveAttendance({ contestSlug, students = [], onProgress = null }) {
    try {
      const rankingProvider = new RankingPageAttendanceProvider();
      return await rankingProvider.resolveAttendance({ contestSlug, students, onProgress });
    } catch (err) {
      // Fail fast for live ranking leaderboard errors (Rate limit 429, 404, 0 participants, page 1 failure, timeouts)
      // Do NOT fall back to multi-minute per-student GraphQL scan when live ranking page 1 fails!
      throw err;
    }
  }
}

module.exports = HybridAttendanceProvider;
