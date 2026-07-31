const BaseAdapter = require('./BaseAdapter');
const CodeChefConnector = require('../connectors/CodeChefConnector');
const standingsProvider = require('../../utils/standingsProvider');
const db = require('../../config/db');

class CodeChefAdapter extends BaseAdapter {
  constructor() {
    super('CodeChef');
  }

  async getProfile(username) {
    try {
      const rawData = await CodeChefConnector.fetchProfile(username);
      const normalized = CodeChefConnector.normalize(rawData, username);
      return {
        ...normalized,
        rawData
      };
    } catch (err) {
      if (err.status === 429 || err.status === 403 || err.code === 'ETIMEDOUT' || err.code === 'NETWORK_TIMEOUT') {
        throw err;
      }
      const msg = err.message || '';
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
        throw err;
      }
      if (msg.includes('not found') || msg.includes('404') || msg.includes('does not exist') || msg.includes('invalid') || msg.includes('unrecognized')) {
        return {
          verified: false,
          message: err.message,
          platform: 'codechef',
          username
        };
      }
      throw err;
    }
  }

  async getContestHistory(username) {
    try {
      const history = await CodeChefConnector.fetchRatingHistory(username);
      return history.map(h => ({
        contestName: h.contestName,
        rating: h.rating,
        date: h.date ? new Date(h.date) : null,
        rank: h.rank,
        score: h.score || 0
      }));
    } catch (err) {
      console.error(`[CodeChefAdapter] Error fetching history for ${username}:`, err.message);
      return [];
    }
  }

  async getContestParticipants(contestId) {
    let slug = contestId;
    if (typeof contestId === 'number' || !isNaN(contestId)) {
      const rows = await db.query("SELECT slug FROM Contests WHERE contest_id = ?", [contestId]);
      if (rows.length > 0) {
        slug = rows[0].slug;
      }
    }

    const list = await standingsProvider.fetchStandings('CodeChef', slug);
    return list;
  }

  async getUpcomingContests() {
    try {
      const list = await standingsProvider.fetchUpcomingContests();
      const now = new Date();
      return list
        .filter(c => c.contest_slug.toLowerCase().includes('codechef') && new Date(c.contest_date) > now)
        .map(c => ({
          title: c.contest_name,
          slug: c.contest_slug,
          startTime: new Date(c.contest_date),
          duration: 10800, // 3 hours
          platform: 'CodeChef'
        }));
    } catch (err) {
      console.error('[CodeChefAdapter] Error fetching upcoming contests:', err.message);
      return [];
    }
  }
}

module.exports = CodeChefAdapter;
