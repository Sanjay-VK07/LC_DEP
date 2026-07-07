const fs = require('fs');
const path = require('path');
const ContestProvider = require('./ContestProvider');
const CapabilityResolver = require('./CapabilityResolver');
const leetcodeUtils = require('../../utils/leetcode');
const db = require('../../config/db');
const { normalizeUsername } = require('../../utils/usernameNormalizer');

/**
 * LeetCode Platform Provider supporting GraphQL queries, Leaderboard scraping, and local file fallbacks.
 */
class LeetCodeProvider extends ContestProvider {
  constructor() {
    super();
    this.name = 'LeetCode';
    this.cacheDir = path.resolve(__dirname, '../../cache/leetcode');
    fs.mkdirSync(this.cacheDir, { recursive: true });

    // Capability Resolver configuration
    this.resolver = new CapabilityResolver('LeetCode', {
      contestDetection: ['graphql', 'cache'],
      liveParticipation: ['cache', 'leaderboard'],
      ratingHistory: ['graphql', 'cache'],
      contestHistory: ['graphql', 'cache']
    });

    // In-memory indexing cache
    this.leaderboardIndices = {}; // contestSlug -> { username: stats }
    this.lastCacheRefresh = {}; // contestSlug -> timestamp
    this.isRefreshingCache = {}; // contestSlug -> boolean
    this.activeRefreshPromises = {}; // contestSlug -> Promise
  }

  /**
   * Helper to return datasource strategies for the capability resolver.
   */
  _getSources(contestSlug) {
    return {
      graphql: {
        fetchContests: async () => {
          const list = await leetcodeUtils.getRecentContests();
          return list.map(c => {
            const startTimeMs = c.startTime * 1000;
            const durationMs = c.duration * 1000;
            const startTime = new Date(startTimeMs);
            const endTime = new Date(startTimeMs + durationMs);

            let status = 'Upcoming';
            const now = Date.now();
            if (now >= startTimeMs && now <= startTimeMs + durationMs) {
              status = 'Live';
            } else if (now > startTimeMs + durationMs) {
              status = 'Completed';
            }

            return {
              contestSlug: c.titleSlug,
              contestName: c.title,
              contestType: c.title.toLowerCase().includes('biweekly') ? 'Biweekly' : 'Weekly',
              startTime,
              endTime,
              platform: 'LeetCode',
              status
            };
          });
        },
        fetchRatings: async (username) => {
          return await leetcodeUtils.getUserContestRankingAndHistory(username);
        },
        fetchContestHistory: async (username) => {
          return await leetcodeUtils.getUserContestHistory(username);
        }
      },
      leaderboard: {
        fetchStudentStatus: async (username, slug) => {
          // If a refresh is not currently running and the cache is older than 4 minutes, trigger background download
          const lastRefresh = this.lastCacheRefresh[slug] || 0;
          const now = Date.now();
          
          if (now - lastRefresh > 4 * 60 * 1000) {
            console.log(`[LeetCodeProvider] Cache is stale/missing for contest "${slug}". Re-fetching leaderboard pages (awaiting completion)...`);
            try {
              await this.refreshLeaderboardCache(slug);
            } catch (err) {
              console.error(`[LeetCodeProvider] Leaderboard cache update failed:`, err.message);
            }
          }

          // Read from memory index
          const index = this.leaderboardIndices[slug] || {};
          const cleanUsername = normalizeUsername(username);
          const stats = index[cleanUsername];
          if (stats) {
            console.log(`[LeetCodeProvider] [Cache Hit] Matched Student: "${username}" (clean: "${cleanUsername}") in contest "${slug}". Rank: ${stats.rank}, Solved: ${stats.solved}, Score: ${stats.score}`);
            return {
              participating: true,
              rank: stats.rank,
              solved: stats.solved,
              score: stats.score,
              penalty: stats.penalty,
              ratingBefore: stats.ratingBefore
            };
          }
          console.log(`[LeetCodeProvider] [Cache Miss] Student: "${username}" (clean: "${cleanUsername}") NOT found in contest "${slug}"`);
          return { participating: false };
        }
      },
      cache: {
        fetchContests: async () => {
          const cacheFile = path.join(this.cacheDir, 'contests_cache.json');
          if (fs.existsSync(cacheFile)) {
            const raw = fs.readFileSync(cacheFile, 'utf8');
            const data = JSON.parse(raw);
            return data.map(c => ({
              ...c,
              startTime: new Date(c.startTime),
              endTime: new Date(c.endTime)
            }));
          }
          throw new Error('Contest cache file not found');
        },
        fetchStudentStatus: async (username, slug) => {
          // Load index if not already loaded in memory
          if (!this.leaderboardIndices[slug]) {
            await this._loadLeaderboard(slug);
          }
          const index = this.leaderboardIndices[slug];
          if (!index) {
            // Throwing triggers failover to leaderboard source
            throw new Error(`Cache missing for contest "${slug}"`);
          }
          const cleanUsername = normalizeUsername(username);
          const stats = index[cleanUsername];
          if (stats) {
            console.log(`[LeetCodeProvider] [Disk/DB Cache Hit] Matched Student: "${username}" (clean: "${cleanUsername}") in contest "${slug}". Rank: ${stats.rank}, Solved: ${stats.solved}`);
            return {
              participating: true,
              rank: stats.rank,
              solved: stats.solved,
              score: stats.score,
              penalty: stats.penalty,
              ratingBefore: stats.ratingBefore
            };
          }
          console.log(`[LeetCodeProvider] [Disk/DB Cache Miss] Student: "${username}" (clean: "${cleanUsername}") NOT found in contest "${slug}"`);
          return { participating: false };
        },
        fetchRatings: async (username) => {
          const file = path.join(this.cacheDir, `rating_${username}.json`);
          if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
          }
          throw new Error(`Rating cache not found for ${username}`);
        },
        fetchContestHistory: async (username) => {
          const file = path.join(this.cacheDir, `history_${username}.json`);
          if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
          }
          throw new Error(`Contest history cache not found for ${username}`);
        }
      }
    };
  }

  async refreshLeaderboardCache(contestSlug) {
    if (this.activeRefreshPromises[contestSlug]) {
      // Re-use active cache refresh promise
      return this.activeRefreshPromises[contestSlug];
    }

    const refreshPromise = (async () => {
      this.isRefreshingCache[contestSlug] = true;
      console.log(`[LeetCodeProvider] Rebuilding leaderboard cache for "${contestSlug}" using LeetCodeAdapter...`);
      try {
        const LeetCodeAdapter = require('../adapters/LeetCodeAdapter');
        const adapter = new LeetCodeAdapter();
        const participants = await adapter.getContestParticipants(contestSlug);

        // Index in memory
        const newIndex = {};
        for (const item of participants) {
          const usernameKey = normalizeUsername(item.username);
          if (!usernameKey) continue;
          newIndex[usernameKey] = {
            username: item.username,
            userSlug: item.username,
            rank: item.rank,
            solved: item.solved || (item.score ? Math.floor(item.score / 3) : 0),
            score: item.score ? parseFloat(item.score) : 0.00,
            penalty: item.finishTime || 0,
            ratingBefore: null
          };
        }
        this.leaderboardIndices[contestSlug] = newIndex;
        this.lastCacheRefresh[contestSlug] = Date.now();
        console.log(`[LeetCodeProvider] Rebuilt leaderboard cache for "${contestSlug}". Indexed ${participants.length} participants.`);
      } catch (err) {
        console.error(`[LeetCodeProvider] Leaderboard cache update failed:`, err.message);
      } finally {
        this.isRefreshingCache[contestSlug] = false;
        delete this.activeRefreshPromises[contestSlug];
      }
    })();

    this.activeRefreshPromises[contestSlug] = refreshPromise;
    return refreshPromise;
  }

  /**
   * Internal helper to load indexes from DB first, falling back to disk files.
   */
  async _loadLeaderboard(contestSlug) {
    // 1. Try to load from database first
    try {
      const rows = await db.query(
        "SELECT username, `rank`, score, finish_time FROM ContestParticipants WHERE contest_slug = ?",
        [contestSlug]
      );
      if (rows.length > 0) {
        const index = {};
        for (const r of rows) {
          const usernameKey = normalizeUsername(r.username);
          if (!usernameKey) continue;
          index[usernameKey] = {
            username: r.username,
            userSlug: r.username,
            rank: r.rank,
            solved: r.score ? Math.floor(r.score / 3) : 0,
            score: parseFloat(r.score || 0),
            penalty: r.finish_time,
            ratingBefore: null
          };
        }
        this.leaderboardIndices[contestSlug] = index;
        console.log(`[LeetCodeProvider] Loaded "${contestSlug}" leaderboard index from database cache (${rows.length} rows).`);
        return;
      }
    } catch (err) {
      console.error(`[LeetCodeProvider] Database cache read failed for "${contestSlug}":`, err.message);
    }

    // 2. Fallback to disk JSON cache
    const file = path.join(this.cacheDir, `${contestSlug}_index.json`);
    if (fs.existsSync(file)) {
      try {
        const raw = fs.readFileSync(file, 'utf8');
        this.leaderboardIndices[contestSlug] = JSON.parse(raw);
        console.log(`[LeetCodeProvider] Loaded "${contestSlug}" leaderboard index from disk cache.`);
      } catch (err) {
        console.error(`[LeetCodeProvider] Disk cache reading error:`, err.message);
      }
    }
  }

  // --- Provider interfaces implementations ---

  async detectContest() {
    return await this.resolver.resolve('contestDetection', this._getSources(), 'fetchContests');
  }

  async getCurrentContest() {
    const list = await this.detectContest();
    const live = list.find(c => c.status === 'Live');
    if (live) return live;
    const upcoming = list.find(c => c.status === 'Upcoming');
    if (upcoming) return upcoming;
    return list[0] || null;
  }

  async getStudentContestStatus(username, contestSlug) {
    return await this.resolver.resolve(
      'liveParticipation', 
      this._getSources(contestSlug), 
      'fetchStudentStatus', 
      [username, contestSlug]
    );
  }

  async getStudentRating(username) {
    const res = await this.resolver.resolve('ratingHistory', this._getSources(), 'fetchRatings', [username]);
    return res.userContestRankingHistory || [];
  }

  async getStudentContestHistory(username) {
    return await this.resolver.resolve('contestHistory', this._getSources(), 'fetchContestHistory', [username]);
  }

  clearContestCache(contestSlug) {
    delete this.leaderboardIndices[contestSlug];
    delete this.lastCacheRefresh[contestSlug];
    
    // Clear files from disk
    const indexFile = path.join(this.cacheDir, `${contestSlug}_index.json`);
    if (fs.existsSync(indexFile)) {
      try { fs.unlinkSync(indexFile); } catch (e) {}
    }
    const contestDir = path.join(this.cacheDir, contestSlug);
    if (fs.existsSync(contestDir)) {
      try {
        const files = fs.readdirSync(contestDir);
        for (const file of files) {
          fs.unlinkSync(path.join(contestDir, file));
        }
        fs.rmdirSync(contestDir);
      } catch (e) {}
    }
    console.log(`[LeetCodeProvider] Standalone leaderboard cache purged for completed contest: "${contestSlug}"`);
  }

  async finalizeContest(contestId) {
    console.log(`[LeetCodeProvider] Finalizing contest ID: ${contestId}`);
    return true;
  }
}

module.exports = LeetCodeProvider;
