const CsvAttendanceProvider = require('./CsvAttendanceProvider');
const ClistAdapter = require('../clist/ClistAdapter');

class AttendanceProviderFactory {
  /**
   * Get an AttendanceProvider instance based on requested type or environment variable.
   * All LeetCode/CodeChef contest attendance routes directly to ClistAdapter.
   * Single-student GraphQL, LeetCode Native scrapers, and Hybrid wrapper fallbacks
   * are completely removed from the attendance runtime selection path.
   * @param {string} [overrideType] - Optional provider type override ('CLIST', 'HYBRID', 'CSV')
   * @param {object} [options] - Additional provider options (e.g. parsed CSV records)
   * @returns {AttendanceProvider}
   */
  static getProvider(overrideType, options = {}) {
    const rawType = overrideType || process.env.SYNC_PROVIDER || 'CLIST';
    const type = rawType.toUpperCase().trim();

    switch (type) {
      case 'CSV':
        return new CsvAttendanceProvider(options.csvRecords || []);
      case 'CLIST':
      case 'HYBRID':
      case 'GRAPHQL':
      case 'RANKING_PAGE':
      case 'LEGACY':
      default:
        // Returns ClistAdapter directly for all attendance syncs.
        // Guarantees zero fallback to RankingPageAttendanceProvider or GraphQL loop.
        return new ClistAdapter();
    }
  }
}

module.exports = AttendanceProviderFactory;
