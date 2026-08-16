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
   * Primary entry point for contest attendance resolution via CLIST.
   * Performs DB caching lookup, live CLIST statistics retrieval, $O(1)$ in-memory handle matching,
   * and strict Attendance Safety evaluation.
   */
  async resolveAttendance({ contestSlug, students = [], onProgress = null, bypassCache = false }) {
    const startTime = Date.now();
    console.log(`[CLIST] Resolving attendance for "${contestSlug}" (${students.length} students, bypassCache: ${bypassCache})...`);

    if (!students || students.length === 0) {
      const emptyArr = [];
      emptyArr.scrapedParticipantCount = 0;
      emptyArr.leaderboardComplete = false;
      emptyArr.syncState = 'EMPTY';
      return emptyArr;
    }

    let participants = null;
    let selectedProviderName = 'CLIST';

    // 1. Stage 1: Check ContestParticipants Cache in DB first (unless bypassCache is true)
    if (!bypassCache) {
      try {
        console.log(`[CLIST] Stage 1: Checking ContestParticipants cache in DB for "${contestSlug}"...`);
        const db = require('../../config/db');
        const cachedRows = await db.query(
          "SELECT username, `rank`, score, problems_solved as problemsSolved, finish_time as finishTime FROM ContestParticipants WHERE contest_slug = ? ORDER BY `rank` ASC",
          [contestSlug]
        );

        if (cachedRows && cachedRows.length > 0) {
          console.log(`[CLIST] Stage 1 Succeeded: DB Cache hit! Found ${cachedRows.length} cached participants for "${contestSlug}".`);
          participants = cachedRows.map(r => ({
            username: r.username,
            rank: r.rank,
            score: Number.parseFloat(r.score) || 0,
            problemsSolved: r.problemsSolved || 0,
            finishTime: r.finishTime || 0,
            provider: 'CACHE',
            source: 'CACHE'
          }));
          participants.leaderboardComplete = true;
          participants.syncState = 'COMPLETE';
          participants.source = 'CACHE';
          participants.provider = 'CACHE';
          selectedProviderName = 'CACHE';
        }
      } catch (cacheErr) {
        console.warn(`[CLIST] Stage 1 Cache query failed: ${cacheErr.message}. Proceeding to live CLIST fetch...`);
      }
    }

    // 2. Stage 2: Fetch CLIST statistics if cache miss or bypassCache
    if (!participants || participants.length === 0) {
      const isCodeChef = contestSlug.toLowerCase().includes('starters') ||
                         contestSlug.toLowerCase().includes('cookoff') ||
                         contestSlug.toLowerCase().includes('lunchtime');
      const resourceHost = isCodeChef ? 'codechef.com' : 'leetcode.com';

      console.log(`[CLIST] Stage 2: Fetching CLIST Contest-Level Statistics for "${contestSlug}" (${resourceHost})...`);
      
      const registeredUsernames = students
        .map(s => normalizeUsername(s.leetcode_username || s.codeforces_username || s.codechef_username || s.username))
        .filter(Boolean);

      const contestSearchRes = await ClistClient.getContests({
        resource: resourceHost,
        search: contestSlug.replace(/-/g, ' ')
      }).catch(() => null);

      let clistContestId = contestSlug;
      if (contestSearchRes && contestSearchRes.objects && contestSearchRes.objects.length > 0) {
        const matchedContest = contestSearchRes.objects.find(c =>
          (c.key || '').toLowerCase() === contestSlug.toLowerCase() ||
          (c.event || '').toLowerCase() === contestSlug.replace(/-/g, ' ').toLowerCase() ||
          (c.href || '').toLowerCase().includes(contestSlug.toLowerCase())
        ) || contestSearchRes.objects[0];
        clistContestId = matchedContest.id;
      }

      participants = await this.getContestParticipants(clistContestId, {
        resource: resourceHost,
        registeredUsernames,
        bypassCache
      });
    }

    // 3. Stage 3: In-Memory Map Matching & Attendance Safety
    const participantMap = new Map();
    if (participants && participants.length > 0) {
      for (const p of participants) {
        const norm = normalizeUsername(p.username);
        if (norm) participantMap.set(norm, p);
      }
    }

    const isLeaderboardComplete = participants ? participants.leaderboardComplete === true : false;
    let matchedCount = 0;
    let completedCount = 0;

    const results = students.map(student => {
      const rawHandle = student.leetcode_username || student.codeforces_username || student.codechef_username || student.username || '';
      const normHandle = normalizeUsername(rawHandle);
      const match = normHandle ? participantMap.get(normHandle) : null;

      completedCount++;
      if (typeof onProgress === 'function') {
        onProgress(completedCount, students.length);
      }

      if (match && (match.rank > 0 || match.score > 0 || match.problemsSolved > 0)) {
        matchedCount++;
        return {
          studentId: student.id,
          username: normHandle || rawHandle,
          contestSlug,
          attended: true,
          status: 'PRESENT',
          rank: match.rank || null,
          score: Number.isFinite(match.score) ? match.score : 0,
          problemsSolved: match.problemsSolved || (match.score > 0 ? Math.min(4, Math.floor(match.score / 3)) : 0),
          totalProblems: 4,
          finishTime: match.finishTime || 0,
          rating: match.rating || null,
          ratingChange: match.ratingChange || 0,
          source: selectedProviderName,
          provider: selectedProviderName,
          error: null
        };
      }

      // ATTENDANCE SAFETY RULE: Mark ABSENT ONLY if leaderboard is 100% complete
      const finalStatus = isLeaderboardComplete ? 'ABSENT' : 'UNKNOWN';

      return {
        studentId: student.id,
        username: normHandle || rawHandle,
        contestSlug,
        attended: false,
        status: finalStatus,
        rank: null,
        score: 0.00,
        problemsSolved: 0,
        totalProblems: 4,
        finishTime: 0,
        rating: null,
        ratingChange: 0,
        source: selectedProviderName,
        provider: selectedProviderName,
        error: isLeaderboardComplete ? null : `Incomplete leaderboard (syncState=${participants ? participants.syncState : 'UNAVAILABLE'})`
      };
    });

    const totalDuration = Date.now() - startTime;
    console.log(`[CLIST] [TELEMETRY] =================================================`);
    console.log(`[CLIST] [TELEMETRY] Contest: ${contestSlug}`);
    console.log(`[CLIST] [TELEMETRY] Registered Students: ${students.length}`);
    console.log(`[CLIST] [TELEMETRY] Provider Selected: ${selectedProviderName}`);
    console.log(`[CLIST] [TELEMETRY] Scraped Participants: ${participants ? participants.length : 0}`);
    console.log(`[CLIST] [TELEMETRY] Local Matches: ${matchedCount}`);
    console.log(`[CLIST] [TELEMETRY] Total Duration: ${totalDuration} ms`);
    console.log(`[CLIST] [TELEMETRY] =================================================`);

    results.scrapedParticipantCount = participants ? (participants.totalCount || participants.length) : 0;
    results.leaderboardComplete = isLeaderboardComplete;
    results.syncState = participants ? participants.syncState : 'UNAVAILABLE';
    return results;
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
    const resourceHost = options.resource || 'leetcode.com';

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

      const isLeetCode = resourceHost === 'leetcode.com';

      if (allObjects.length === 0) {
        participants.syncState = 'EMPTY';
        participants.leaderboardComplete = false;
        participants.attendanceVerified = false;
      } else if (isEarlyExit) {
        participants.syncState = 'VERIFIED_FOR_REGISTERED_STUDENTS';
        participants.leaderboardComplete = false; // NEVER treat as LEADERBOARD_COMPLETE
        participants.attendanceVerified = true;
      } else if (!hasMore && (!remainingToMatch || remainingToMatch.size === 0) && !isLeetCode) {
        // Only non-LeetCode providers with proven 100% complete coverage can be marked COMPLETE
        participants.syncState = 'COMPLETE';
        participants.leaderboardComplete = true;
        participants.attendanceVerified = true;
      } else {
        // LeetCode CLIST statistics dataset indexes active participants (~14.5k) and omits 0-point registrants.
        // Therefore, it must ALWAYS be treated as PARTIAL for negative evidence evaluation to prevent false absences.
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
