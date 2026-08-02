const GraphQLAttendanceProvider = require('./GraphQLAttendanceProvider');
const CsvAttendanceProvider = require('./CsvAttendanceProvider');
const LegacyAttendanceProvider = require('./LegacyAttendanceProvider');
const RankingPageAttendanceProvider = require('./RankingPageAttendanceProvider');
const HybridAttendanceProvider = require('./HybridAttendanceProvider');

class AttendanceProviderFactory {
  /**
   * Get an AttendanceProvider instance based on requested type or environment variable.
   * @param {string} [overrideType] - Optional provider type override ('GRAPHQL', 'CSV', 'LEGACY', 'HYBRID')
   * @param {object} [options] - Additional provider options (e.g. parsed CSV records)
   * @returns {AttendanceProvider}
   */
  static getProvider(overrideType, options = {}) {
    const rawType = overrideType || process.env.SYNC_PROVIDER || 'HYBRID';
    const type = rawType.toUpperCase().trim();

    switch (type) {
      case 'GRAPHQL':
        return new GraphQLAttendanceProvider();
      case 'CSV':
        return new CsvAttendanceProvider(options.csvRecords || []);
      case 'LEGACY':
        return new LegacyAttendanceProvider();
      case 'RANKING_PAGE':
        return new RankingPageAttendanceProvider();
      case 'HYBRID':
      default:
        // HYBRID defaults to the live ranking-page leaderboard, since it reflects
        // real contest results immediately. GraphQL's userContestRankingHistory
        // field can lag a day or more behind, so it's used only as a fallback
        // (see HybridAttendanceProvider).
        return new HybridAttendanceProvider();
    }
  }
}

module.exports = AttendanceProviderFactory;
