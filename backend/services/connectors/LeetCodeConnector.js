const fs = require('fs');
const path = require('path');
const { verifyLeetCodeUsername, getUserLeetCodeStats, getUserContestRankingAndHistory } = require('../../utils/leetcode');
const { normalizeLeetCodeProfile } = require('../normalizationService');

const LeetCodeConnector = {
  /**
   * Verify if a profile exists.
   */
  async verifyProfile(username) {
    try {
      const result = await verifyLeetCodeUsername(username);
      return {
        exists: !!result?.exists,
        username: result?.username || username,
        rating: result?.rating || null,
        globalRanking: result?.globalRanking || null
      };
    } catch (err) {
      return { exists: false, error: err.message };
    }
  },

  /**
   * Fetch full profile.
   */
  async fetchProfile(username) {
    const cacheDir = path.resolve(__dirname, '../../cache/leetcode');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, `profile_${username}.json`);
    const TTL = 6 * 60 * 60 * 1000; // 6 hours TTL

    // Check if fresh cache exists
    if (fs.existsSync(cacheFile)) {
      try {
        const stats = fs.statSync(cacheFile);
        if (Date.now() - stats.mtimeMs < TTL) {
          console.log(`[LeetCodeConnector] [Cache Hit] Returning fresh profile cache for ${username}.`);
          return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        }
      } catch (e) {}
    }

    try {
      const stats = await getUserLeetCodeStats(username);
      if (!stats || !stats.success) {
        throw new Error(stats?.error || 'Failed to fetch LeetCode profile');
      }
      
      // Fetch and merge LeetCode contest history
      try {
        const historyData = await getUserContestRankingAndHistory(username);
        if (historyData && historyData.userContestRankingHistory) {
          stats.contestHistory = historyData.userContestRankingHistory;
          // Fix 4: maxRating must be the historical peak, not the current contestRating.
          // This ensures Best Rating stays correct for users whose rating has dropped.
          const ratings = stats.contestHistory
            .map(h => h.rating)
            .filter(r => r !== null && r !== undefined && Number.isFinite(Number(r)));
          if (ratings.length > 0) {
            stats.maxRating = Math.max(...ratings);
          } else {
            // No history entries with valid ratings — fall back to current rating
            stats.maxRating = stats.contestRating ?? stats.rating ?? 1500;
          }
        } else {
          stats.contestHistory = [];
          stats.maxRating = stats.contestRating ?? stats.rating ?? 1500;
        }
      } catch (err) {
        console.warn(`[LeetCodeConnector] Failed to fetch contest history for ${username}:`, err.message);
        stats.contestHistory = [];
        stats.maxRating = stats.contestRating ?? stats.rating ?? 1500;
      }

      // Save to cache
      fs.writeFileSync(cacheFile, JSON.stringify(stats, null, 2));
      console.log(`[LeetCodeConnector] [GraphQL] Fetched and cached profile for ${username}.`);
      return stats;
    } catch (err) {
      console.warn(`[LeetCodeConnector] Failed to fetch profile for ${username}: ${err.message}. Attempting stale cache fallback...`);
      if (fs.existsSync(cacheFile)) {
        try {
          console.log(`[LeetCodeConnector] [Fallback Success] Returning stale profile cache for ${username}.`);
          return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        } catch (e) {}
      }
      throw err;
    }
  },

  /**
   * Fetch contest participation history.
   */
  async fetchContestHistory(username) {
    const stats = await this.fetchProfile(username);
    // LeetCode stats contains contestHistory already.
    return stats.contestHistory || [];
  },

  /**
   * Fetch rating history.
   */
  async fetchRatingHistory(username) {
    const history = await this.fetchContestHistory(username);
    return history.map(h => ({
      contestName: h.contest?.title || 'Unknown Contest',
      rating: h.rating,
      date: h.contest?.startTime ? new Date(h.contest.startTime * 1000).toISOString() : null,
      rank: h.ranking
    }));
  },

  /**
   * Fetch solved problems count.
   */
  async fetchSolvedProblems(username) {
    const stats = await this.fetchProfile(username);
    return {
      totalSolved: stats.totalSolved || 0,
      easySolved: stats.easySolved || 0,
      mediumSolved: stats.mediumSolved || 0,
      hardSolved: stats.hardSolved || 0
    };
  },

  /**
   * Normalize platform details to the database representation.
   */
  normalize(rawData, username) {
    return normalizeLeetCodeProfile(rawData, username);
  }
};

module.exports = LeetCodeConnector;
