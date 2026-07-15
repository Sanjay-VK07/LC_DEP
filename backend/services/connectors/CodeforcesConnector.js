const { verifyCodeforcesUsername, getUserCodeforcesStats } = require('../../utils/codeforces');
const { normalizeCodeforcesProfile } = require('../normalizationService');

const CodeforcesConnector = {
  /**
   * Verify if a profile exists.
   */
  async verifyProfile(username) {
    try {
      const result = await verifyCodeforcesUsername(username);
      return {
        exists: !!result?.exists,
        username: result?.username || username,
        rating: result?.rating || null,
        maxRating: result?.maxRating || null,
        rank: result?.rank || null,
        maxRank: result?.maxRank || null
      };
    } catch (err) {
      return { exists: false, error: err.message };
    }
  },

  /**
   * Fetch full profile.
   */
  async fetchProfile(username) {
    const stats = await getUserCodeforcesStats(username);
    if (!stats || !stats.success) {
      throw new Error(stats?.error || 'Failed to fetch Codeforces profile');
    }

    // Fix 5: Cross-validate maxRating against contest history.
    // The Codeforces API can occasionally return a stale or incorrect maxRating.
    // We take the greater of the API-reported value and the history-derived max.
    if (Array.isArray(stats.contestHistory) && stats.contestHistory.length > 0) {
      const ratings = stats.contestHistory
        .map(h => h.newRating)
        .filter(r => r !== null && r !== undefined && Number.isFinite(Number(r)));
      if (ratings.length > 0) {
        const historyMax = Math.max(...ratings);
        stats.maxRating = Math.max(historyMax, Number(stats.maxRating) || 0);
      }
    }

    return stats;
  },

  /**
   * Fetch contest history.
   */
  async fetchContestHistory(username) {
    const stats = await this.fetchProfile(username);
    return stats.contestHistory || [];
  },

  /**
   * Fetch rating history.
   */
  async fetchRatingHistory(username) {
    const history = await this.fetchContestHistory(username);
    return history.map(h => ({
      contestName: h.contestName || 'Unknown Contest',
      rating: h.newRating,
      date: h.ratingUpdateTimeSeconds ? new Date(h.ratingUpdateTimeSeconds * 1000).toISOString() : null,
      rank: h.rank
    }));
  },

  /**
   * Fetch solved problems.
   */
  async fetchSolvedProblems(username) {
    const stats = await this.fetchProfile(username);
    return {
      totalSolved: stats.problemsSolved || 0
    };
  },

  /**
   * Normalize platform details to the database representation.
   */
  normalize(rawData, username) {
    return normalizeCodeforcesProfile(rawData, username);
  }
};

module.exports = CodeforcesConnector;
