const BaseAdapter = require('./BaseAdapter');
const CodeforcesConnector = require('../connectors/CodeforcesConnector');
const { queryCodeforces } = require('../../utils/codeforces');
const db = require('../../config/db');

class CodeforcesAdapter extends BaseAdapter {
  constructor() {
    super('Codeforces');
  }

  async getProfile(username) {
    try {
      const rawData = await CodeforcesConnector.fetchProfile(username);
      const normalized = CodeforcesConnector.normalize(rawData, username);
      return {
        ...normalized,
        rawData
      };
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('not found') || msg.includes('404') || msg.includes('does not exist') || msg.includes('invalid') || msg.includes('handles:')) {
        return {
          verified: false,
          message: err.message,
          platform: 'codeforces',
          username
        };
      }
      throw err;
    }
  }

  async getContestHistory(username) {
    try {
      const history = await CodeforcesConnector.fetchRatingHistory(username);
      return history.map(h => ({
        contestName: h.contestName,
        rating: h.rating,
        date: h.date ? new Date(h.date) : null,
        rank: h.rank,
        score: h.score || 0
      }));
    } catch (err) {
      console.error(`[CodeforcesAdapter] Error fetching history for ${username}:`, err.message);
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

    const match = String(slug).match(/(\d+)/);
    if (!match) {
      throw new Error(`Invalid Codeforces contest identifier: ${slug}`);
    }
    const cfId = match[1];

    try {
      const response = await queryCodeforces(`/api/contest.standings?contestId=${cfId}&showUnofficial=true`);
      if (response.status === 'OK' && response.result && response.result.rows) {
        return response.result.rows.map(row => ({
          username: row.party.members[0].handle,
          rank: row.rank,
          score: row.points,
          finishTime: row.penalty || 0
        }));
      }
    } catch (err) {
      console.warn(`[CodeforcesAdapter] Failed to fetch live standings for ${cfId}:`, err.message);
    }

    // Fallback to standingsProvider
    const standingsProvider = require('../../utils/standingsProvider');
    const list = await standingsProvider.fetchStandings('Codeforces', slug);
    return list;
  }

  async getUpcomingContests() {
    try {
      const response = await queryCodeforces('/api/contest.list?gym=false');
      const now = Math.floor(Date.now() / 1000);
      if (response.status === 'OK' && response.result) {
        return response.result
          .filter(c => c.startTimeSeconds > now)
          .map(c => ({
            title: c.name,
            slug: 'codeforces-' + c.id,
            startTime: new Date(c.startTimeSeconds * 1000),
            duration: c.durationSeconds,
            platform: 'Codeforces'
          }));
      }
    } catch (err) {
      console.error('[CodeforcesAdapter] Error fetching upcoming contests:', err.message);
    }
    return [];
  }
}

module.exports = CodeforcesAdapter;
