const CsvAttendanceProvider = require('./CsvAttendanceProvider');
const ClistAdapter = require('../clist/ClistAdapter');
const GraphQLAttendanceProvider = require('./GraphQLAttendanceProvider');

class AttendanceProviderFactory {
  /**
   * Get an AttendanceProvider instance based on requested type or environment variable.
   * If CLIST is configured with API keys, it uses ClistAdapter.
   * If CLIST is unavailable or unconfigured, it automatically falls back to GraphQLAttendanceProvider.
   * @param {string} [overrideType] - Optional provider type override ('CLIST', 'GRAPHQL', 'CSV')
   * @param {object} [options] - Additional provider options (e.g. parsed CSV records)
   * @returns {AttendanceProvider}
   */
  static getProvider(overrideType, options = {}) {
    const rawType = overrideType || process.env.SYNC_PROVIDER || 'AUTO';
    const type = rawType.toUpperCase().trim();

    switch (type) {
      case 'CSV':
        return new CsvAttendanceProvider(options.csvRecords || []);
      case 'GRAPHQL':
        return new GraphQLAttendanceProvider();
      case 'CLIST': {
        const clist = new ClistAdapter();
        if (clist.isAvailable()) return clist;
        return new GraphQLAttendanceProvider();
      }
      default: {
        const clist = new ClistAdapter();
        if (clist.isAvailable()) return clist;
        return new GraphQLAttendanceProvider();
      }
    }
  }
}

module.exports = AttendanceProviderFactory;
