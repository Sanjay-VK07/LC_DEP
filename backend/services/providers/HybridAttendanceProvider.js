const AttendanceProvider = require('./AttendanceProvider');
const GraphQLAttendanceProvider = require('./GraphQLAttendanceProvider');
const RankingPageAttendanceProvider = require('./RankingPageAttendanceProvider');
const ClistAdapter = require('../clist/ClistAdapter');
const leetAiClient = require('../../utils/leetAiClient');
const { normalizeUsername } = require('../../utils/usernameNormalizer');

const LARGE_SYNC_THRESHOLD = 50;

/**
 * Optimized HYBRID Attendance Provider:
 * For large student syncs (>= 50 students), prioritizes contest-level participant
 * retrieval (LeetCode Native Leaderboard -> Leet.ai -> CLIST Statistics), followed
 * by local in-memory username matching and strict attendance safety evaluation.
 * For small/targeted syncs (< 50 students), delegates to single-student GraphQL verification.
 */
class HybridAttendanceProvider extends AttendanceProvider {
  constructor() {
    super('HYBRID');
    this.providerName = 'HYBRID';
  }

  async resolveAttendance({ contestSlug, students = [], onProgress = null, bypassCache = false }) {
    const startTime = Date.now();
    console.log(`[HybridAttendanceProvider] Resolving attendance for "${contestSlug}" (${students.length} students, bypassCache: ${bypassCache})...`);

    // 1. Small targeted syncs (< 50 students): Delegate to single-student GraphQL provider
    if (students.length < LARGE_SYNC_THRESHOLD) {
      console.log(`[HybridAttendanceProvider] Small student count (${students.length} < ${LARGE_SYNC_THRESHOLD}). Using targeted single-student GraphQL provider...`);
      const gqlProvider = new GraphQLAttendanceProvider();
      return await gqlProvider.resolveAttendance({ contestSlug, students, onProgress });
    }

    // 2. Large syncs (>= 50 students): Executing Contest-Level Sync Strategy
    console.log(`[HybridAttendanceProvider] Large student sync (${students.length} students >= ${LARGE_SYNC_THRESHOLD}). Executing Contest-Level Sync Strategy...`);

    let participants = null;
    let selectedProviderName = 'NONE';

    // Stage A: Check ContestParticipants Cache in DB first (unless bypassCache is true)
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
        console.warn(`[HybridAttendanceProvider] Stage 1 Cache query failed: ${cacheErr.message}. Proceeding to live providers...`);
      }
    }

    // Stage B: Try Leet.ai Contest-Level Ranking (if configured)
    if (leetAiClient.isConfigured() && leetAiClient.hasContestParticipantEndpoint(contestSlug)) {
      try {
        console.log(`[HybridAttendanceProvider] Stage 2: Attempting Leet.ai Contest Ranking for "${contestSlug}"...`);
        const aiParticipants = await leetAiClient.getContestRanking(contestSlug);
        if (aiParticipants && aiParticipants.length > 0) {
          console.log(`[HybridAttendanceProvider] Stage 2 Succeeded: Leet.ai returned ${aiParticipants.length} participants.`);
          participants = aiParticipants;
          participants.provider = 'LEETAI';
          participants.source = 'LEETAI_API';
          participants.leaderboardComplete = true;
          participants.syncState = 'COMPLETE';
          selectedProviderName = 'LEETAI';
        }
      } catch (aiErr) {
        console.warn(`[HybridAttendanceProvider] Stage 2 Failed (Leet.ai): ${aiErr.message}. Trying CLIST fallback...`);
      }
    }

    // Stage C: Try CLIST Contest-Level Statistics (Common Fallback for LeetCode & CodeChef)
    if (!participants || participants.length === 0) {
      const clistAdapter = new ClistAdapter();
      if (clistAdapter.isAvailable()) {
        console.log(`[HybridAttendanceProvider] Stage 3: Attempting CLIST Contest-Level Statistics for "${contestSlug}"...`);
        try {
          const registeredUsernames = students
            .map(s => normalizeUsername(s.leetcode_username || s.codeforces_username || s.codechef_username || s.username))
            .filter(Boolean);

          const ClistClient = require('../clist/ClistClient');
          
          const isCodeChef = contestSlug.toLowerCase().includes('starters') || contestSlug.toLowerCase().includes('cookoff') || contestSlug.toLowerCase().includes('lunchtime');
          const resourceHost = isCodeChef ? 'codechef.com' : 'leetcode.com';

          const contestSearchRes = await ClistClient.getContests({
            resource: resourceHost,
            search: contestSlug.replace(/-/g, ' ')
          }).catch(() => null);

          let clistContestId = contestSlug;
          if (contestSearchRes && contestSearchRes.objects && contestSearchRes.objects.length > 0) {
            const matchedContest = contestSearchRes.objects.find(c =>
              (c.key || '').toLowerCase() === contestSlug.toLowerCase() ||
              (c.event || '').toLowerCase() === contestSlug.replace(/-/g, ' ').toLowerCase()
            ) || contestSearchRes.objects[0];
            clistContestId = matchedContest.id;
          }

          const clistParticipants = await clistAdapter.getContestParticipants(clistContestId, {
            resource: resourceHost,
            registeredUsernames,
            bypassCache
          });

          if (clistParticipants && clistParticipants.length > 0) {
            console.log(`[HybridAttendanceProvider] Stage 3 Succeeded: CLIST returned ${clistParticipants.length} participants (syncState="${clistParticipants.syncState}", complete=${clistParticipants.leaderboardComplete}).`);
            participants = clistParticipants;
            selectedProviderName = 'CLIST';
          }
        } catch (clistErr) {
          console.warn(`[HybridAttendanceProvider] Stage 3 Failed (CLIST): ${clistErr.message}.`);
        }
      }
    }

    // Stage D: Process Contest-Level Participant Data with Local Matching & Attendance Safety
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
      console.log(`[HybridAttendanceProvider] [TELEMETRY] External Requests: 1-2 paginated calls`);
      console.log(`[HybridAttendanceProvider] [TELEMETRY] Scraped Participants: ${participants.length}`);
      console.log(`[HybridAttendanceProvider] [TELEMETRY] Local Matches: ${matchedCount}`);
      console.log(`[HybridAttendanceProvider] [TELEMETRY] Total Duration: ${totalDuration} ms`);
      console.log(`[HybridAttendanceProvider] [TELEMETRY] =================================================`);

      results.scrapedParticipantCount = participants.length;
      results.leaderboardComplete = isLeaderboardComplete;
      results.syncState = participants.syncState;
      return results;
    }

    // Stage E: Last Resort - Single-Student GraphQL Provider if all contest-level providers failed
    console.warn(`[HybridAttendanceProvider] All contest-level providers failed for "${contestSlug}". Falling back to targeted single-student GraphQL provider...`);
    const gqlProvider = new GraphQLAttendanceProvider();
    return await gqlProvider.resolveAttendance({ contestSlug, students, onProgress });
  }
}

module.exports = HybridAttendanceProvider;


