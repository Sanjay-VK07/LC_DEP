const AttendanceProvider = require('./AttendanceProvider');
const ClistAdapter = require('../clist/ClistAdapter');
const ClistClient = require('../clist/ClistClient');
const { normalizeUsername } = require('../../utils/usernameNormalizer');

/**
 * CLIST-Driven HYBRID Attendance Provider:
 * Uses CLIST API v4 directly as the primary external provider for LeetCode (and CodeChef)
 * contest attendance. Eliminates N+1 single-student GraphQL queries and unreliable scrapers.
 * Performs contest-level participant fetching, DB caching, $O(1)$ local in-memory username matching,
 * and strict Attendance Safety evaluation.
 */
class HybridAttendanceProvider extends AttendanceProvider {
  constructor() {
    super('CLIST');
    this.providerName = 'CLIST';
  }

  async resolveAttendance({ contestSlug, students = [], onProgress = null, bypassCache = false }) {
    const startTime = Date.now();
    console.log(`[HybridAttendanceProvider] Resolving attendance for "${contestSlug}" (${students.length} students, bypassCache: ${bypassCache})...`);

    if (!students || students.length === 0) {
      const emptyArr = [];
      emptyArr.scrapedParticipantCount = 0;
      emptyArr.leaderboardComplete = true;
      emptyArr.syncState = 'EMPTY';
      return emptyArr;
    }

    let participants = null;
    let selectedProviderName = 'NONE';

    // Stage 1: Check ContestParticipants Cache in DB first (unless bypassCache is true)
    if (!bypassCache) {
      try {
        console.log(`[HybridAttendanceProvider] Stage 1: Checking ContestParticipants cache in DB for "${contestSlug}"...`);
        const db = require('../../config/db');
        const cachedRows = await db.query(
          "SELECT username, `rank`, score, problems_solved as problemsSolved, finish_time as finishTime FROM ContestParticipants WHERE contest_slug = ? ORDER BY `rank` ASC",
          [contestSlug]
        );

        if (cachedRows && cachedRows.length > 0) {
          console.log(`[HybridAttendanceProvider] Stage 1 Succeeded: DB Cache hit! Found ${cachedRows.length} cached participants for "${contestSlug}".`);
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
        console.warn(`[HybridAttendanceProvider] Stage 1 Cache query failed: ${cacheErr.message}. Proceeding to live CLIST fetch...`);
      }
    }

    // Stage 2: CLIST API v4 Contest-Level Statistics (Primary Provider for LeetCode & CodeChef)
    if (!participants || participants.length === 0) {
      const clistAdapter = new ClistAdapter();
      if (clistAdapter.isAvailable()) {
        console.log(`[HybridAttendanceProvider] Stage 2: Fetching CLIST Contest-Level Statistics for "${contestSlug}"...`);
        try {
          const registeredUsernames = students
            .map(s => normalizeUsername(s.leetcode_username || s.codeforces_username || s.codechef_username || s.username))
            .filter(Boolean);

          const isCodeChef = contestSlug.toLowerCase().includes('starters') ||
                             contestSlug.toLowerCase().includes('cookoff') ||
                             contestSlug.toLowerCase().includes('lunchtime');
          const resourceHost = isCodeChef ? 'codechef.com' : 'leetcode.com';

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

          const clistParticipants = await clistAdapter.getContestParticipants(clistContestId, {
            resource: resourceHost,
            registeredUsernames,
            bypassCache
          });

          if (clistParticipants && clistParticipants.length > 0) {
            console.log(`[HybridAttendanceProvider] Stage 2 Succeeded: CLIST returned ${clistParticipants.length} participants (syncState="${clistParticipants.syncState}", complete=${clistParticipants.leaderboardComplete}).`);
            participants = clistParticipants;
            selectedProviderName = 'CLIST';
          }
        } catch (clistErr) {
          console.warn(`[HybridAttendanceProvider] Stage 2 Failed (CLIST): ${clistErr.message}.`);
        }
      } else {
        console.warn(`[HybridAttendanceProvider] CLIST provider is not configured or unavailable.`);
      }
    }

    // Stage 3: Process Contest-Level Participant Data with Local Matching & Attendance Safety
    if (participants && participants.length > 0) {
      const participantMap = new Map();
      for (const p of participants) {
        const norm = normalizeUsername(p.username);
        if (norm) participantMap.set(norm, p);
      }

      const isLeaderboardComplete = participants.leaderboardComplete === true;
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
            source: participants.source || selectedProviderName,
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
          source: participants.source || selectedProviderName,
          provider: selectedProviderName,
          error: isLeaderboardComplete ? null : `Incomplete leaderboard (syncState=${participants.syncState})`
        };
      });

      const totalDuration = Date.now() - startTime;
      console.log(`[HybridAttendanceProvider] [TELEMETRY] =================================================`);
      console.log(`[HybridAttendanceProvider] [TELEMETRY] Contest: ${contestSlug}`);
      console.log(`[HybridAttendanceProvider] [TELEMETRY] Registered Students: ${students.length}`);
      console.log(`[HybridAttendanceProvider] [TELEMETRY] Provider Selected: ${selectedProviderName}`);
      console.log(`[HybridAttendanceProvider] [TELEMETRY] Scraped Participants: ${participants.length}`);
      console.log(`[HybridAttendanceProvider] [TELEMETRY] Local Matches: ${matchedCount}`);
      console.log(`[HybridAttendanceProvider] [TELEMETRY] Total Duration: ${totalDuration} ms`);
      console.log(`[HybridAttendanceProvider] [TELEMETRY] =================================================`);

      results.scrapedParticipantCount = participants ? (participants.totalCount || participants.length) : 0;
      results.leaderboardComplete = isLeaderboardComplete;
      results.syncState = participants.syncState;
      return results;
    }

    // Fallback: If no participant data could be retrieved from CLIST or Cache
    console.warn(`[HybridAttendanceProvider] No participant data available for "${contestSlug}". Returning NOT_VERIFIED status.`);
    const fallbackResults = students.map(student => {
      const rawHandle = student.leetcode_username || student.codeforces_username || student.codechef_username || student.username || '';
      return {
        studentId: student.id,
        username: normalizeUsername(rawHandle) || rawHandle,
        contestSlug,
        attended: false,
        status: 'UNKNOWN',
        rank: null,
        score: 0.00,
        problemsSolved: 0,
        totalProblems: 4,
        finishTime: 0,
        rating: null,
        ratingChange: 0,
        source: 'CLIST',
        provider: 'CLIST',
        error: 'Participant data unavailable from CLIST'
      };
    });

    fallbackResults.scrapedParticipantCount = 0;
    fallbackResults.leaderboardComplete = false;
    fallbackResults.syncState = 'UNAVAILABLE';
    return fallbackResults;
  }
}

module.exports = HybridAttendanceProvider;
