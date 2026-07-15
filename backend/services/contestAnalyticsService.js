/**
 * ContestAnalyticsService
 * ========================
 * Centralized contest-level analytics — contest reports, batch/section/dept summaries,
 * rating history, and contest attendance generation.
 * 
 * All controllers must delegate contest analytics to this service.
 */

const db = require('../config/db');

/**
 * Parse contest_history JSON safely.
 * @param {string|null} raw - JSON string
 * @returns {Array}
 */
function parseContestHistory(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/**
 * Normalize a LeetCode contest history entry to the unified format.
 */
function normalizeLeetCodeEntry(entry) {
  return {
    platform: 'leetcode',
    contestName: entry.contest?.title || entry.contestName || 'Unknown Contest',
    contestSlug: entry.contest?.titleSlug || null,
    contestDate: entry.contest?.startTime
      ? new Date(entry.contest.startTime * 1000).toISOString()
      : (entry.contestDate || null),
    rank: entry.ranking || entry.rank || null,
    oldRating: entry.oldRating || null,
    newRating: entry.rating || entry.newRating || null,
    ratingChange: entry.trendingDirection != null
      ? (entry.rating - (entry.oldRating || entry.rating))
      : (entry.ratingChange || 0),
    attended: entry.attended !== false,
    score: entry.score || entry.finishTimeInSeconds || null
  };
}

/**
 * Normalize a CodeChef contest history entry to the unified format.
 */
function normalizeCodeChefEntry(entry) {
  return {
    platform: 'codechef',
    contestName: entry.contestName || entry.contest?.title || 'Unknown Contest',
    contestSlug: null,
    contestDate: entry.contestDate || entry.contest?.startTime || null,
    rank: entry.rank || entry.ranking || null,
    oldRating: entry.oldRating || null,
    newRating: entry.newRating || entry.rating || null,
    ratingChange: entry.ratingChange || 0,
    attended: entry.attended !== false,
    score: null
  };
}

/**
 * Normalize a Codeforces contest history entry to the unified format.
 */
function normalizeCodeforcesEntry(entry) {
  return {
    platform: 'codeforces',
    contestName: entry.contestName || 'Unknown Contest',
    contestSlug: null,
    contestDate: entry.ratingUpdateTimeSeconds
      ? new Date(entry.ratingUpdateTimeSeconds * 1000).toISOString()
      : null,
    rank: entry.rank || null,
    oldRating: entry.oldRating || null,
    newRating: entry.newRating || null,
    ratingChange: (entry.newRating && entry.oldRating)
      ? entry.newRating - entry.oldRating
      : 0,
    attended: true,
    score: null
  };
}

/**
 * Get unified contest history for a student across all platforms.
 * @param {number} userId
 * @returns {object} - { leetcode, codechef, codeforces, combined }
 */
async function getStudentContestHistory(userId) {
  const [profiles] = await db.query(
    `SELECT 
       lp.contest_history as lc_history,
       cp.contest_history as cc_history,
       cfp.contest_history as cf_history
     FROM Users u
     LEFT JOIN LeetCodeProfiles lp ON lp.user_id = u.id
     LEFT JOIN CodeChefProfiles cp ON cp.user_id = u.id
     LEFT JOIN CodeforcesProfiles cfp ON cfp.user_id = u.id
     WHERE u.id = ?`,
    [userId]
  );

  if (!profiles) return { leetcode: [], codechef: [], codeforces: [], combined: [] };

  const lcRaw = parseContestHistory(profiles.lc_history);
  const ccRaw = parseContestHistory(profiles.cc_history);
  const cfRaw = parseContestHistory(profiles.cf_history);

  const leetcode = lcRaw.map(normalizeLeetCodeEntry).filter(e => e.attended);
  const codechef = ccRaw.map(normalizeCodeChefEntry).filter(e => e.attended);
  const codeforces = cfRaw.map(normalizeCodeforcesEntry);

  const combined = [...leetcode, ...codechef, ...codeforces]
    .sort((a, b) => {
      const da = a.contestDate ? new Date(a.contestDate) : new Date(0);
      const db2 = b.contestDate ? new Date(b.contestDate) : new Date(0);
      return da - db2;
    });

  return { leetcode, codechef, codeforces, combined };
}

/**
 * Get platform-specific rating history for a student.
 * Returns rating progression sorted by date (oldest first).
 * @param {number} userId
 * @param {string} platform - 'leetcode' | 'codechef' | 'codeforces'
 * @returns {Array} - [{ date, rating, ratingChange, rank, contestName }]
 */
async function getRatingHistory(userId, platform) {
  const tableMap = {
    leetcode: 'LeetCodeProfiles',
    codechef: 'CodeChefProfiles',
    codeforces: 'CodeforcesProfiles'
  };
  const table = tableMap[platform];
  if (!table) return [];

  const [row] = await db.query(
    `SELECT contest_history FROM ${table} WHERE user_id = ?`,
    [userId]
  );
  if (!row) return [];

  const raw = parseContestHistory(row.contest_history);
  let normalized;

  if (platform === 'leetcode') {
    normalized = raw.map(normalizeLeetCodeEntry).filter(e => e.attended && e.newRating);
  } else if (platform === 'codechef') {
    normalized = raw.map(normalizeCodeChefEntry).filter(e => e.newRating);
  } else {
    normalized = raw.map(normalizeCodeforcesEntry).filter(e => e.newRating);
  }

  return normalized
    .sort((a, b) => {
      const da = a.contestDate ? new Date(a.contestDate) : new Date(0);
      const db2 = b.contestDate ? new Date(b.contestDate) : new Date(0);
      return da - db2;
    })
    .map(e => ({
      date: e.contestDate,
      rating: e.newRating,
      ratingChange: e.ratingChange,
      rank: e.rank,
      contestName: e.contestName
    }));
}

/**
 * Get summary statistics for all contests (dashboard reports).
 * @returns {object}
 */
async function getContestSummaryStats() {
  const [overall] = await db.query(
    `SELECT 
       COUNT(*) as total_contests,
       SUM(CASE WHEN contest_status = 'Rated' THEN 1 ELSE 0 END) as rated,
       SUM(CASE WHEN contest_status = 'Unrated' THEN 1 ELSE 0 END) as unrated,
       SUM(CASE WHEN contest_status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled,
       SUM(CASE WHEN contest_type = 'Weekly' THEN 1 ELSE 0 END) as weekly,
       SUM(CASE WHEN contest_type = 'Biweekly' THEN 1 ELSE 0 END) as biweekly,
       COUNT(DISTINCT YEAR(start_time)) as years_covered
     FROM Contests`
  );

  const [ended] = await db.query(
    `SELECT COUNT(*) as ended_count
     FROM Contests
     WHERE start_time + INTERVAL IFNULL(duration,5400) SECOND <= NOW()
       AND contest_status != 'Cancelled'`
  );

  const [upcoming] = await db.query(
    `SELECT COUNT(*) as upcoming_count
     FROM Contests
     WHERE start_time > NOW()`
  );

  return {
    total: Number(overall?.total_contests || 0),
    rated: Number(overall?.rated || 0),
    unrated: Number(overall?.unrated || 0),
    cancelled: Number(overall?.cancelled || 0),
    weekly: Number(overall?.weekly || 0),
    biweekly: Number(overall?.biweekly || 0),
    ended: Number(ended?.ended_count || 0),
    upcoming: Number(upcoming?.upcoming_count || 0)
  };
}

/**
 * Get per-contest attendance report.
 * @param {object} filters - { type?, startDate?, endDate?, contestId? }
 * @returns {Array}
 */
async function getContestAttendanceReport({ type, startDate, endDate, contestId } = {}) {
  let sql = `
    SELECT 
      c.contest_id, c.title as contest_name, c.slug as contest_slug,
      c.start_time as contest_date, c.contest_status, c.contest_type,
      COUNT(DISTINCT r.id) as registered,
      COUNT(DISTINCT p.id) as participated,
      ROUND(IFNULL(COUNT(DISTINCT p.id) / NULLIF(COUNT(DISTINCT r.id), 0) * 100, 0)) as attendance_pct
    FROM Contests c
    LEFT JOIN Registrations r ON r.contest_id = c.contest_id
    LEFT JOIN ParticipationLogs p ON p.contest_id = c.contest_id
    WHERE 1=1
  `;
  const params = [];

  if (contestId) { sql += ' AND c.contest_id = ?'; params.push(contestId); }
  if (type) { sql += ' AND c.contest_type = ?'; params.push(type); }
  if (startDate) { sql += ' AND c.start_time >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND c.start_time <= ?'; params.push(endDate); }

  sql += ' GROUP BY c.contest_id, c.title, c.slug, c.start_time, c.contest_status, c.contest_type ORDER BY c.start_time DESC';

  return await db.query(sql, params);
}

/**
 * Get weekly trend data (attendance counts grouped by week).
 * @param {number} weeksBack - Number of weeks to look back (default 12)
 * @returns {Array} - [{ week_label, contest_count, attended_count }]
 */
async function getWeeklyTrend(weeksBack = 12) {
  const rows = await db.query(
    `SELECT 
       DATE_FORMAT(c.start_time, '%Y-%u') as week_key,
       MIN(DATE(c.start_time)) as week_start,
       COUNT(DISTINCT c.contest_id) as contest_count,
       COUNT(DISTINCT p.user_id) as unique_participants
     FROM Contests c
     LEFT JOIN ParticipationLogs p ON p.contest_id = c.contest_id
     WHERE c.start_time >= DATE_SUB(NOW(), INTERVAL ? WEEK)
       AND c.contest_status = 'Rated'
       AND c.start_time + INTERVAL IFNULL(c.duration,5400) SECOND <= NOW()
     GROUP BY week_key
     ORDER BY week_key ASC`,
    [weeksBack]
  );
  return rows;
}

module.exports = {
  parseContestHistory,
  normalizeLeetCodeEntry,
  normalizeCodeChefEntry,
  normalizeCodeforcesEntry,
  getStudentContestHistory,
  getRatingHistory,
  getContestSummaryStats,
  getContestAttendanceReport,
  getWeeklyTrend
};
