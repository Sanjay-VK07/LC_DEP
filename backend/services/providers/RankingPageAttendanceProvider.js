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

  async resolveAttendance({ contestSlug, students = [], onProgress = null }) {
    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS] Fetching live leaderboard for "${contestSlug}"...`);
    const adapter = new LeetCodeAdapter();
    const participants = await adapter.getContestParticipants(contestSlug);

    if (!participants || participants.length === 0) {
      throw new Error(`Live ranking-page leaderboard for "${contestSlug}" returned no participants.`);
    }

    const participantMap = new Map();
    for (const p of participants) {
      const norm = normalizeUsername(p.username);
      if (norm) participantMap.set(norm, p);
    }

    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS] Leaderboard loaded: ${participantMap.size} unique participants. Matching against ${students.length} students...`);

    const results = [];
    let completed = 0;
    for (const student of students) {
      const normHandle = normalizeUsername(student.leetcode_username || student.username);
      const match = normHandle ? participantMap.get(normHandle) : null;

      if (match) {
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
        results.push({
          studentId: student.id,
          username: normHandle || student.leetcode_username || '',
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
    console.log(`[RankingPageAttendanceProvider] [DIAGNOSTICS] Matched ${presentCount}/${students.length} students as PRESENT via live leaderboard.`);

    return results;
  }
}

module.exports = RankingPageAttendanceProvider;
