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

async function fetchWithRetry(normHandle, timeoutMs = 20000, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const queryPromise = leetcodeUtils.getUserContestRankingAndHistory(normHandle);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`GraphQL request timeout for ${normHandle} after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)
      );
      return await Promise.race([queryPromise, timeoutPromise]);
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const backoffMs = 1000 * Math.pow(2, attempt - 1);
      console.warn(`[GraphQLAttendanceProvider] Retry attempt ${attempt}/${maxRetries} for ${normHandle} after error: "${err.message}". Retrying in ${backoffMs}ms...`);
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
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
  async resolveAttendance({ contestSlug, students = [], onProgress = null }) {
    const targetSlug = slugifyTitle(contestSlug);
    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] ========== Resolve Attendance Start ==========`);
    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] Target Contest Slug Received: "${contestSlug}"`);
    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] Normalized Target Slug: "${targetSlug}"`);
    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] Active Students Count to Process: ${students.length}`);

    const results = [];
    const failedUsernames = [];
    const timeoutUsernames = [];

    const CONCURRENCY = parseInt(process.env.LEETCODE_GRAPHQL_CONCURRENCY, 10) || 5;
    const DELAY_MS = parseInt(process.env.LEETCODE_GRAPHQL_DELAY_MS, 10) || 50;

    let index = 0;
    let completed = 0;
    const total = students.length;

    const reportProgress = () => {
      completed++;
      if (typeof onProgress === 'function' && total > 0) {
        onProgress(completed, total);
      }
    };

    const worker = async () => {
      while (index < students.length) {
        const student = students[index++];
        if (!student) continue;

        try {

        const rawHandle = student.leetcode_username || student.username;
        const normHandle = normalizeUsername(rawHandle);

        if (!normHandle) {
          failedUsernames.push(rawHandle || `Student_ID_${student.id}`);
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
          // Bounded 20-second timeout per student GraphQL lookup with 3 retries (exponential backoff)
          const data = await fetchWithRetry(normHandle, 20000, 3);
          const history = data?.userContestRankingHistory || [];
          const userRanking = data?.userContestRanking || {};

          // Find contest in user's history
          let match = history.find(h => {
            const hTitle = h?.contest?.title || '';
            const hSlug = h?.contest?.titleSlug || slugifyTitle(hTitle);
            const slugifiedTitle = slugifyTitle(hTitle);

            return hSlug === targetSlug || 
                   slugifiedTitle === targetSlug || 
                   (hTitle && hTitle.toLowerCase() === contestSlug.toLowerCase());
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

            console.log(`[GraphQLAttendanceProvider] [MATCH] User "${normHandle}": Contest Title="${match.contest?.title}", TitleSlug="${match.contest?.titleSlug || 'N/A'}", Attended=${isAttended}, Solved=${problemsSolved}`);

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
              rating: rating || (userRanking.rating ? Math.round(userRanking.rating) : null),
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
          failedUsernames.push(normHandle);
          if (err.message && err.message.includes('timeout')) {
            timeoutUsernames.push(normHandle);
          }
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
            status: 'BLOCKED_UPSTREAM',
            source: 'GRAPHQL',
            provider: 'GRAPHQL',
            error: err.message
          });
        }

        } finally {
          reportProgress();
        }
      }
    };

    const pool = [];
    for (let i = 0; i < Math.min(CONCURRENCY, students.length); i++) {
      pool.push(worker());
    }
    await Promise.all(pool);

    const presentCount = results.filter(r => r.status === 'PRESENT').length;
    const absentCount = results.filter(r => r.status === 'ABSENT').length;
    const blockedCount = results.filter(r => r.status === 'BLOCKED_UPSTREAM').length;

    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] ========== Resolve Attendance Complete ==========`);
    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] Contest Slug: "${contestSlug}"`);
    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] Number of participants before filtering: ${students.length}`);
    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] Number of results resolved: ${results.length}`);
    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] Present Participants: ${presentCount}`);
    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] Absent Participants: ${absentCount}`);
    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] Blocked/Upstream Errors: ${blockedCount}`);
    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] Failed Usernames (${failedUsernames.length}):`, failedUsernames);
    console.log(`[GraphQLAttendanceProvider] [DIAGNOSTICS] Timeout Usernames (${timeoutUsernames.length}):`, timeoutUsernames);

    return results;
  }
}

module.exports = GraphQLAttendanceProvider;
