const AttendanceProvider = require('./AttendanceProvider');
const leetcodeUtils = require('../../utils/leetcode');
const { normalizeUsername } = require('../../utils/usernameNormalizer');

function slugifyTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

class GraphQLAttendanceProvider extends AttendanceProvider {
  constructor() {
    super('GRAPHQL');
  }

  /**
   * Resolve contest attendance using LeetCode GraphQL queries.
   * @param {object} options
   * @param {string} options.contestSlug - Target contest slug
   * @param {Array<object>} options.students - Active student records
   * @returns {Promise<Array<object>>}
   */
  async resolveAttendance({ contestSlug, students = [] }) {
    const targetSlug = slugifyTitle(contestSlug);
    const results = [];

    const CONCURRENCY = parseInt(process.env.LEETCODE_GRAPHQL_CONCURRENCY, 10) || 2;
    const DELAY_MS = parseInt(process.env.LEETCODE_GRAPHQL_DELAY_MS, 10) || 300;

    let index = 0;

    const worker = async () => {
      while (index < students.length) {
        const student = students[index++];
        if (!student) continue;

        const rawHandle = student.leetcode_username || student.username;
        const normHandle = normalizeUsername(rawHandle);

        if (!normHandle) {
          results.push({
            studentId: student.id,
            username: rawHandle || '',
            contestSlug,
            attended: false,
            rank: null,
            score: 0.00,
            problemsSolved: 0,
            totalProblems: 4,
            finishTime: 0,
            rating: null,
            ratingChange: 0,
            status: 'UNKNOWN',
            source: 'GRAPHQL',
            provider: 'GRAPHQL',
            error: 'Username unverified or missing'
          });
          continue;
        }

        if (DELAY_MS > 0) {
          await new Promise(r => setTimeout(r, DELAY_MS));
        }

        try {
          const data = await leetcodeUtils.getUserContestRankingAndHistory(normHandle);
          const history = data?.userContestRankingHistory || [];
          const userRanking = data?.userContestRanking || {};

          // Find contest in user's history
          let match = history.find(h => {
            const hSlug = slugifyTitle(h?.contest?.title || '');
            return hSlug === targetSlug || (h?.contest?.title && h.contest.title.toLowerCase() === contestSlug.toLowerCase());
          });

          if (match) {
            const isAttended = Boolean(match.attended);
            const rank = match.ranking || null;
            const problemsSolved = match.problemsSolved ?? 0;
            const totalProblems = match.totalProblems ?? 4;
            const rating = match.rating ? Math.round(match.rating) : null;
            const finishTime = match.finishTimeInSeconds || 0;
            const score = Number.parseFloat((problemsSolved * 5.0).toFixed(2));

            // Calculate rating change
            const matchIdx = history.indexOf(match);
            const prevContest = matchIdx > 0 ? history[matchIdx - 1] : null;
            const ratingChange = (rating && prevContest && prevContest.rating) 
              ? Math.round(rating - prevContest.rating) 
              : 0;

            results.push({
              studentId: student.id,
              username: normHandle,
              contestSlug,
              attended: isAttended,
              rank: isAttended ? rank : null,
              score: isAttended ? score : 0.00,
              problemsSolved: isAttended ? problemsSolved : 0,
              totalProblems: isAttended ? totalProblems : 4,
              finishTime: isAttended ? finishTime : 0,
              rating: rating || userRanking.rating ? Math.round(userRanking.rating) : null,
              ratingChange: isAttended ? ratingChange : 0,
              status: isAttended ? 'PRESENT' : 'ABSENT',
              source: 'GRAPHQL',
              provider: 'GRAPHQL',
              rawData: match
            });
          } else {
            // Student history loaded cleanly, but no contest entry exists for this contest
            results.push({
              studentId: student.id,
              username: normHandle,
              contestSlug,
              attended: false,
              rank: null,
              score: 0.00,
              problemsSolved: 0,
              totalProblems: 4,
              finishTime: 0,
              rating: userRanking.rating ? Math.round(userRanking.rating) : null,
              ratingChange: 0,
              status: 'ABSENT',
              source: 'GRAPHQL',
              provider: 'GRAPHQL'
            });
          }
        } catch (err) {
          console.warn(`[GraphQLAttendanceProvider] Query failed for ${normHandle}:`, err.message);
          const isCf = err.name === 'CloudflareBlockedError' || err.message?.includes('Cloudflare') || err.message?.includes('403');
          results.push({
            studentId: student.id,
            username: normHandle,
            contestSlug,
            attended: false,
            rank: null,
            score: 0.00,
            problemsSolved: 0,
            totalProblems: 4,
            finishTime: 0,
            rating: null,
            ratingChange: 0,
            status: isCf ? 'BLOCKED_UPSTREAM' : 'BLOCKED_UPSTREAM',
            source: 'GRAPHQL',
            provider: 'GRAPHQL',
            error: err.message
          });
        }
      }
    };

    const pool = [];
    for (let i = 0; i < Math.min(CONCURRENCY, students.length); i++) {
      pool.push(worker());
    }
    await Promise.all(pool);

    return results;
  }
}

module.exports = GraphQLAttendanceProvider;
