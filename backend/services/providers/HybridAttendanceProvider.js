const AttendanceProvider = require('./AttendanceProvider');
const RankingPageAttendanceProvider = require('./RankingPageAttendanceProvider');
const GraphQLAttendanceProvider = require('./GraphQLAttendanceProvider');

/**
 * Tries the live ranking-page leaderboard first (fast, reflects real contest
 * results immediately). Falls back to GraphQL userContestRankingHistory only
 * if the leaderboard scrape fails outright (e.g. contest too old for LeetCode's
 * ranking-page retention, or Cloudflare blocked every page).
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
