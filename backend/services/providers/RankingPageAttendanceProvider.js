const AttendanceProvider = require('./AttendanceProvider');
const LeetCodeAdapter = require('../adapters/LeetCodeAdapter');
const { normalizeUsername } = require('../../utils/usernameNormalizer');

/**
 * Resolves attendance from LeetCode's live contest ranking-page leaderboard
 * (via LeetCodeAdapter.getContestParticipants), instead of the GraphQL
 * userContestRankingHistory field. The ranking page reflects real contest
 * results immediately after a contest ends, whereas userContestRankingHistory
 * can lag a day or more before it's updated for a given user.
 */
class RankingPageAttendanceProvider extends AttendanceProvider {
  constructor() {
    super('RANKING_PAGE');
  }

  async resolveAttendance({ contestSlug, students = [], onProgress = null, bypassCache = true }) {
    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS] Fetching live leaderboard for "${contestSlug}" (bypassCache: ${bypassCache})...`);
    const adapter = new LeetCodeAdapter();
    let participants;
    try {
      participants = await adapter.getContestParticipants(contestSlug, { bypassCache });
    } catch (err) {
      throw err;
    }

    if (!participants || participants.length === 0) {
      throw new Error(`Contest '${contestSlug}' leaderboard is empty or has 0 participants. Verify contest has started and finished.`);
    }

    // Build participant lookup map with explicit normalization on scraped usernames
    const participantMap = new Map();
    for (const p of participants) {
      const norm = normalizeUsername(p.username);
      if (norm) participantMap.set(norm, p);
    }

    // Extract and normalize stored student handles
    const normalizedStudents = students.map(s => ({
      ...s,
      rawHandle: s.leetcode_username || s.username || '',
      normHandle: normalizeUsername(s.leetcode_username || s.username)
    }));

    // -------------------------------------------------------------------------
    // DEBUG LOGGING (Requirement 2)
    // -------------------------------------------------------------------------
    const totalScrapedCount = participants.length;
    const scrapedUsernamesSample = Array.from(participantMap.keys()).slice(0, 5);
    const storedStudentUsernamesSample = normalizedStudents
      .map(s => s.normHandle)
      .filter(Boolean)
      .slice(0, 5);

    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS] ================= DEBUG LOGGING =================`);
    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS] a) Total Scraped Participants Count: ${totalScrapedCount} (Unique Normalized: ${participantMap.size})`);
    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS] b) Sample Scraped Usernames (5):`, scrapedUsernamesSample);
    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS] c) Sample Stored Student Usernames (5):`, storedStudentUsernamesSample);

    const results = [];
    const hitsSample = [];
    const missesSample = [];
    let completed = 0;

    for (const student of normalizedStudents) {
      const normHandle = student.normHandle;
      const match = normHandle ? participantMap.get(normHandle) : null;

      if (match) {
        if (hitsSample.length < 5) {
          hitsSample.push({ studentId: student.id, raw: student.rawHandle, norm: normHandle, rank: match.rank });
        }
        results.push({
          studentId: student.id,
          username: normHandle,
          contestSlug,
          attended: true,
          rank: match.rank ?? null,
          score: Number.isFinite(match.score) ? match.score : 0,
          problemsSolved: match.problemsSolved || 0,
          totalProblems: 4,
          finishTime: match.finishTime || 0,
          rating: null,
          ratingChange: 0,
          status: 'PRESENT',
          source: 'RANKING_PAGE',
          provider: 'RANKING_PAGE',
          rawData: match
        });
      } else {
        if (missesSample.length < 5) {
          missesSample.push({ studentId: student.id, raw: student.rawHandle, norm: normHandle });
        }
        results.push({
          studentId: student.id,
          username: normHandle || student.rawHandle || '',
          contestSlug,
          attended: false,
          rank: null,
          score: 0,
          problemsSolved: 0,
          totalProblems: 4,
          finishTime: 0,
          rating: null,
          ratingChange: 0,
          status: 'ABSENT',
          source: 'RANKING_PAGE',
          provider: 'RANKING_PAGE'
        });
      }

      completed++;
      if (typeof onProgress === 'function') {
        onProgress(completed, students.length);
      }
    }

    const presentCount = results.filter(r => r.status === 'PRESENT').length;
    const absentCount = results.filter(r => r.status === 'ABSENT').length;

    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS] d) Hits-vs-Misses Breakdown:`);
    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS]    - Total Present (Hits): ${presentCount} / ${students.length}`);
    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS]    - Total Absent (Misses): ${absentCount} / ${students.length}`);
    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS]    - Sample Hits (Matched Handles):`, hitsSample);
    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS]    - Sample Misses (Unmatched Handles):`, missesSample);
    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS] =================================================`);

    results.scrapedParticipantCount = totalScrapedCount;
    results.pagesFetched = participants.pagesFetched || 1;
    return results;
  }
}

module.exports = RankingPageAttendanceProvider;
