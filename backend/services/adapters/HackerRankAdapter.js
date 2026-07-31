const BaseAdapter = require('./BaseAdapter');
const HackerRankConnector = require('../connectors/HackerRankConnector');
const standingsProvider = require('../../utils/standingsProvider');
const db = require('../../config/db');

class HackerRankAdapter extends BaseAdapter {
  constructor() {
    super('HackerRank');
  }

  async getProfile(username) {
    try {
      const rawData = await HackerRankConnector.fetchProfile(username);
      const normalized = HackerRankConnector.normalize(rawData, username);
      return {
        ...normalized,
        rawData
      };
    } catch (err) {
      if (err.status === 429 || err.status === 403 || err.code === 'ETIMEDOUT' || err.code === 'NETWORK_TIMEOUT') {
        throw err;
      }
      const msg = err.message || '';
      if (msg.includes('not found') || msg.includes('404') || msg.includes('does not exist') || msg.includes('invalid') || msg.includes('unrecognized')) {
        return {
          verified: false,
          message: err.message,
          platform: 'hackerrank',
          username
        };
      }
      throw err;
    }
  }

  async getContestHistory(username) {
    return [];
  }

  async getContestParticipants(contestId) {
    let slug = contestId;
    if (typeof contestId === 'number' || !isNaN(contestId)) {
      const rows = await db.query("SELECT slug FROM Contests WHERE contest_id = ?", [contestId]);
      if (rows.length > 0) {
        slug = rows[0].slug;
      }
    }

    const list = await standingsProvider.fetchStandings('HackerRank', slug);
    return list;
  }

  async getUpcomingContests() {
    try {
      const list = await standingsProvider.fetchUpcomingContests();
      const now = new Date();
      return list
        .filter(c => c.contest_slug.toLowerCase().includes('hackerrank') && new Date(c.contest_date) > now)
        .map(c => ({
          title: c.contest_name,
          slug: c.contest_slug,
          startTime: new Date(c.contest_date),
          duration: 5400, // 1.5 hours
          platform: 'HackerRank'
        }));
    } catch (err) {
      console.error('[HackerRankAdapter] Error fetching upcoming contests:', err.message);
      return [];
    }
  }
}

module.exports = HackerRankAdapter;
