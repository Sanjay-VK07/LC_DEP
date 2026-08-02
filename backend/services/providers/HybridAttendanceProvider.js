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
      console.warn(`[HybridAttendanceProvider] Ranking-page leaderboard failed for "${contestSlug}" (${err.message}). Falling back to GraphQL history...`);
      const graphqlProvider = new GraphQLAttendanceProvider();
      return await graphqlProvider.resolveAttendance({ contestSlug, students, onProgress });
    }
  }
}

module.exports = HybridAttendanceProvider;
