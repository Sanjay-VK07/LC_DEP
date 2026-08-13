const BaseAdapter = require('../adapters/BaseAdapter');
const ClistClient = require('./ClistClient');
const { normalizeUsername } = require('../../utils/usernameNormalizer');

class ClistAdapter extends BaseAdapter {
  constructor() {
    super('CLIST');
    this.providerName = 'CLIST';
  }

  isAvailable() {
    return ClistClient.isConfigured();
  }

  /**
   * Fetch and return normalized list of upcoming or recent contests from CLIST.
   */
  async getUpcomingContests(options = {}) {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      const response = await ClistClient.getContests({
        upcoming: true,
        limit: options.limit || 50,
        resource: options.resource || null
      });

      const objects = response.objects || [];
      return objects.map(contest => this.normalizeContest(contest));
    } catch (err) {
      console.error('[CLIST] Error fetching upcoming contests:', err.message);
      return [];
    }
  }

  /**
   * Fetch contest participants/standings for a contest key, ID, or slug from CLIST.
   * Options:
   *  - registeredUsernames: Set or Array of normalized handles to match for early exit optimization.
   *  - resource: Platform resource (e.g. leetcode.com)
   *  - maxPages: Ceiling on max pages to fetch (default: unlimited up to completion)
   */
  async getContestParticipants(contestKey, options = {}) {
    if (!this.isAvailable()) {
      const emptyArr = [];
      emptyArr.provider = 'clist';
      emptyArr.source = 'CLIST';
      emptyArr.syncState = 'UNAVAILABLE';
      emptyArr.leaderboardComplete = false;
      emptyArr.attendanceVerified = false;
      emptyArr.totalCount = 0;
      return emptyArr;
    }

    const registeredSet = options.registeredUsernames 
      ? new Set(Array.from(options.registeredUsernames).map(u => normalizeUsername(u)))
      : null;
    const remainingToMatch = registeredSet ? new Set(registeredSet) : null;

    let allObjects = [];
    let page = 0;
    let limit = options.limit || 1000;
    let offset = 0;
    let hasMore = true;
    let totalCount = 0;
    let isEarlyExit = false;

    try {
      while (hasMore) {
        page++;
        const response = await ClistClient.getContestParticipants(contestKey, {
          ...options,
          limit,
          offset,
          bypassCache: options.bypassCache
        });

        const objects = response.objects || [];
        const meta = response.meta || {};
        totalCount = meta.estimated_count || meta.total_count || totalCount || objects.length;

        if (objects.length === 0) {
          hasMore = false;
          break;
        }

        allObjects.push(...objects);

        // Early-exit check: Check if all registered student handles have been matched
        if (remainingToMatch && remainingToMatch.size > 0) {
          for (const item of objects) {
            const normHandle = normalizeUsername(item.handle || item.account || item.username);
            if (remainingToMatch.has(normHandle)) {
              remainingToMatch.delete(normHandle);
            }
          }
          if (remainingToMatch.size === 0) {
            console.log(`[CLIST Adapter] Early-Exit triggered! All ${registeredSet.size} registered student handles matched on page ${page}.`);
            isEarlyExit = true;
            hasMore = false;
            break;
          }
        }

        if (!meta.next) {
          hasMore = false;
        } else {
          offset += limit;
          if (options.maxPages && page >= options.maxPages) {
            console.log(`[CLIST Adapter] Reached maxPages ceiling (${options.maxPages}). Stopping pagination.`);
            hasMore = false;
          }
        }
      }

      const participants = allObjects.map(item => this.normalizeParticipant(item, contestKey));
      participants.provider = 'clist';
      participants.source = 'CLIST';
      participants.totalCount = totalCount;

      if (allObjects.length === 0) {
        participants.syncState = 'EMPTY';
        participants.leaderboardComplete = true;
        participants.attendanceVerified = true;
      } else if (isEarlyExit) {
        participants.syncState = 'VERIFIED_FOR_REGISTERED_STUDENTS';
        participants.leaderboardComplete = false; // NEVER treat as LEADERBOARD_COMPLETE
        participants.attendanceVerified = true;
      } else if (!hasMore && (!remainingToMatch || remainingToMatch.size === 0)) {
        participants.syncState = 'COMPLETE';
        participants.leaderboardComplete = true;
        participants.attendanceVerified = true;
      } else {
        participants.syncState = 'PARTIAL';
        participants.leaderboardComplete = false;
        participants.attendanceVerified = false;
      }

      return participants;
    } catch (err) {
      console.error(`[CLIST] Error fetching contest participants for "${contestKey}":`, err.message);
      
      const partialArr = allObjects.map(item => this.normalizeParticipant(item, contestKey));
      partialArr.provider = 'clist';
      partialArr.source = 'CLIST';
      partialArr.syncState = (err.status === 401 || err.status === 403) ? 'UNAVAILABLE' : 'PARTIAL';
      partialArr.leaderboardComplete = false;
      partialArr.attendanceVerified = false;
      partialArr.totalCount = totalCount;
      partialArr.error = err.message;
      return partialArr;
    }
  }

  /**
   * Fetch profile stats for a handle on a platform via CLIST.
   */
  async getProfile(username, resource = null) {
    if (!this.isAvailable()) {
      return { verified: false, message: 'CLIST provider disabled', platform: 'clist', username };
    }

    try {
      const response = await ClistClient.getUserInfo(username, resource);
      const objects = response.objects || [];
      if (objects.length > 0) {
        const account = objects[0];
        return {
          verified: true,
          username: normalizeUsername(account.handle || username),
          rating: account.rating ? parseInt(account.rating, 10) : null,
          highestRating: account.max_rating ? parseInt(account.max_rating, 10) : null,
          globalRanking: account.global_rank ? parseInt(account.global_rank, 10) : null,
          problemsSolved: account.n_problems ? parseInt(account.n_problems, 10) : 0,
          platform: 'clist',
          provider: 'clist',
          rawData: account
        };
      }
      return { verified: false, message: 'Account not found on CLIST', platform: 'clist', username };
    } catch (err) {
      return { verified: false, message: err.message, platform: 'clist', username };
    }
  }

  /**
   * Fetch contest history for a user handle.
   */
  async getContestHistory(username, resource = null) {
    if (!this.isAvailable()) return [];

    try {
      const response = await ClistClient.getContestParticipants(username, { limit: 100, resource });
      const objects = response.objects || [];
      return objects.map(item => ({
        contestName: item.contest || 'Unknown Contest',
        rating: item.new_rating || item.rating || null,
        rank: item.place ? parseInt(item.place, 10) : null,
        score: item.score !== undefined ? parseFloat(item.score) : (item.solving !== undefined ? parseFloat(item.solving) : 0),
        date: item.end_time || null,
        platform: 'clist',
        provider: 'clist'
      }));
    } catch (err) {
      console.error(`[CLIST] Error fetching history for ${username}:`, err.message);
      return [];
    }
  }

  /**
   * Normalize CLIST raw contest object to CodeTrack internal format.
   */
  normalizeContest(rawContest) {
    const startTime = rawContest.start ? new Date(rawContest.start) : null;
    const endTime = rawContest.end ? new Date(rawContest.end) : null;
    const duration = rawContest.duration ? parseInt(rawContest.duration, 10) : 0;

    return {
      id: rawContest.id,
      name: rawContest.event || rawContest.title || 'Unknown Contest',
      slug: rawContest.key || rawContest.event || `clist-${rawContest.id}`,
      platform: 'clist',
      originalPlatform: rawContest.resource || 'Unknown',
      startTime,
      endTime,
      duration,
      url: rawContest.href || null
    };
  }

  /**
   * Normalize CLIST raw statistics/participant object to CodeTrack internal format.
   */
  normalizeParticipant(rawStat, contestId) {
    const handle = rawStat.handle || rawStat.account || rawStat.username || '';
    const place = rawStat.place ? parseInt(rawStat.place, 10) : null;
    const score = rawStat.score !== undefined ? parseFloat(rawStat.score) : (rawStat.solving !== undefined ? parseFloat(rawStat.solving) : 0);
    const penalty = rawStat.penalty !== undefined ? parseInt(rawStat.penalty, 10) : 0;

    return {
      contestId: contestId || rawStat.contest_id || rawStat.contest_key,
      username: normalizeUsername(handle),
      rank: place,
      score,
      penalty,
      finishTime: penalty,
      platform: 'clist',
      provider: 'clist'
    };
  }
}

module.exports = ClistAdapter;
