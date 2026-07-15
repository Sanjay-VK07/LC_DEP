/**
 * PlatformAnalyticsService
 * ========================
 * Unified cross-platform analytics:
 * - Leaderboards (by rating, solved, attendance, score)
 * - Department analytics with platform adoption
 * - Rating distribution histograms
 * - Student unified profile aggregation
 * All controllers delegate here instead of computing independently.
 */

const db = require('../config/db');
const cache = require('./analyticsCacheService');
const { computeOverallScore } = require('./dashboardMetricsService');
const { parseContestHistory, normalizeLeetCodeEntry, normalizeCodeChefEntry, normalizeCodeforcesEntry } = require('./contestAnalyticsService');

/**
 * Build platform list for a user row.
 */
function buildPlatformList(user) {
  return [
    { platform: 'leetcode', label: 'LeetCode', username: user.leetcode_username },
    { platform: 'codechef', label: 'CodeChef', username: user.codechef_username },
    { platform: 'codeforces', label: 'Codeforces', username: user.codeforces_username },
    { platform: 'hackerrank', label: 'HackerRank', username: user.hackerrank_username }
  ].filter(p => p.username && String(p.username).trim());
}

/**
 * Get leaderboard data.
 * @param {object} filters - { department?, section?, academicBatch?, sortBy?, limit? }
 * @returns {object} - { topPerformers, topImprovers, mostConsistent, coverageSummary }
 */
async function getLeaderboards({ department, section, academicBatch, sortBy = 'rating', limit = 100 } = {}) {
  const cacheKey = cache.KEYS.LEADERBOARDS(`${department}:${section}:${academicBatch}:${sortBy}`);
  return cache.getOrCompute(cacheKey, async () => {
    let filterSql = '';
    const params = [];
    if (department) { filterSql += ' AND u.department = ?'; params.push(department); }
    if (section) { filterSql += ' AND u.section = ?'; params.push(section); }
    if (academicBatch) { filterSql += ' AND u.academic_batch = ?'; params.push(academicBatch); }

    const baseQuery = `
      SELECT u.id, u.name, u.roll_no as register_number,
             u.leetcode_username, u.codechef_username, u.codeforces_username, u.hackerrank_username,
             u.department, u.section, u.academic_batch as academic_year,
             ROUND(IFNULL(lp.current_rating, 0)) as lc_current_rating,
             ROUND(IFNULL(lp.highest_rating, 0)) as lc_best_rating,
             lp.global_ranking as lc_best_rank,
             IFNULL(lp.problems_solved, 0) as lc_solved,
             ROUND(IFNULL(cp.current_rating, 0)) as cc_current_rating,
             ROUND(IFNULL(cp.highest_rating, 0)) as cc_best_rating,
             cp.stars as cc_stars,
             IFNULL(cp.problems_solved, 0) as cc_solved,
             ROUND(IFNULL(cfp.current_rating, 0)) as cf_current_rating,
             ROUND(IFNULL(cfp.highest_rating, 0)) as cf_best_rating,
             cfp.\`rank\` as cf_rank,
             IFNULL(cfp.problems_solved, 0) as cf_solved,
             IFNULL(hrp.problems_solved, 0) as hr_solved,
             IFNULL(hrp.stars, 0) as hr_stars,
             IFNULL((SELECT COUNT(*) FROM ParticipationLogs p WHERE p.user_id = u.id), 0) as contests_attended
      FROM Users u
      LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
      LEFT JOIN CodeChefProfiles cp ON u.id = cp.user_id
      LEFT JOIN CodeforcesProfiles cfp ON u.id = cfp.user_id
      LEFT JOIN HackerRankProfiles hrp ON u.id = hrp.user_id
      WHERE u.status = 'active'${filterSql}
    `;

    const safeLimit = Number.parseInt(limit, 10) || 100;
    if (!Number.isInteger(safeLimit) || safeLimit <= 0) {
      throw new Error("Invalid limit");
    }

    const rows = await db.query(baseQuery + ` ORDER BY lc_current_rating DESC, cc_current_rating DESC LIMIT ${Math.max(safeLimit, 10)}`,
      params);

    const enriched = rows.map(r => {
      const totalSolved = Number(r.lc_solved) + Number(r.cc_solved) + Number(r.cf_solved) + Number(r.hr_solved);
      const overallScore = computeOverallScore(
        Number(r.lc_current_rating), Number(r.cc_current_rating), Number(r.cf_current_rating),
        Number(r.lc_solved), Number(r.cc_solved), Number(r.cf_solved), Number(r.hr_solved)
      );
      const platformCount = buildPlatformList(r).length;
      return {
        ...r,
        current_rating: Number(r.lc_current_rating),
        best_rating: Number(r.lc_best_rating),
        best_rank: r.lc_best_rank,
        codechef_rating: Number(r.cc_current_rating),
        codeforces_rating: Number(r.cf_current_rating),
        problems_solved: totalSolved,
        overall_score: overallScore,
        platform_count: platformCount,
        platforms: buildPlatformList(r)
      };
    });

    // Sort variants
    let topPerformers = [...enriched];
    if (sortBy === 'solved') topPerformers.sort((a, b) => b.problems_solved - a.problems_solved);
    else if (sortBy === 'attendance') topPerformers.sort((a, b) => b.contests_attended - a.contests_attended);
    else if (sortBy === 'score') topPerformers.sort((a, b) => b.overall_score - a.overall_score);
    else if (sortBy === 'codechef') topPerformers.sort((a, b) => b.codechef_rating - a.codechef_rating);
    else if (sortBy === 'codeforces') topPerformers.sort((a, b) => b.codeforces_rating - a.codeforces_rating);
    else topPerformers.sort((a, b) => b.current_rating - a.current_rating);

    // Top improvers
    const topImprovers = [...enriched]
      .filter(r => Number(r.lc_current_rating) > 1500)
      .map(r => ({ ...r, rating_gain: Number(r.lc_current_rating) - 1500 }))
      .sort((a, b) => b.rating_gain - a.rating_gain)
      .slice(0, 20);

    // Most consistent — rewritten with JOINs instead of correlated subqueries
    const mostConsistent = await db.query(
      `SELECT u.id, u.name, u.roll_no as register_number,
              u.leetcode_username, u.codechef_username, u.codeforces_username, u.hackerrank_username,
              u.department,
              COUNT(DISTINCT r.id) as total_contests,
              COUNT(DISTINCT p.id) as present_count,
              ROUND(IFNULL(COUNT(DISTINCT p.id) / NULLIF(COUNT(DISTINCT r.id), 0) * 100, 0)) as attendance_percentage
       FROM Users u
       LEFT JOIN Registrations r ON r.user_id = u.id
         JOIN Contests cr ON r.contest_id = cr.contest_id AND cr.contest_status = 'Rated'
           AND cr.start_time + INTERVAL IFNULL(cr.duration,5400) SECOND <= NOW()
       LEFT JOIN ParticipationLogs p ON p.user_id = u.id
         JOIN Contests cp2 ON p.contest_id = cp2.contest_id AND cp2.contest_status = 'Rated'
           AND cp2.start_time + INTERVAL IFNULL(cp2.duration,5400) SECOND <= NOW()
       WHERE u.status = 'active'${filterSql}
       GROUP BY u.id, u.name, u.roll_no, u.leetcode_username, u.codechef_username, u.codeforces_username, u.hackerrank_username, u.department
       HAVING total_contests >= 3
       ORDER BY attendance_percentage DESC, present_count DESC
       LIMIT 20`,
      params
    );

    const coverageSummary = {
      totalProfiles: enriched.length,
      multiPlatformProfiles: enriched.filter(r => r.platform_count > 1).length,
      averagePlatformCount: enriched.length > 0
        ? (enriched.reduce((s, r) => s + r.platform_count, 0) / enriched.length).toFixed(1)
        : '0.0'
    };

    return { topPerformers, topImprovers, mostConsistent, coverageSummary };
  }, 8 * 60 * 1000);
}


/**
 * Get rating distribution histogram (all platforms combined).
 * @returns {object} - { leetcode, codechef, codeforces, combined }
 */
async function getRatingDistribution() {
  return cache.getOrCompute(cache.KEYS.RATING_DISTRIBUTION, async () => {
    const bands = [
      { label: '< 1200', min: 0, max: 1199 },
      { label: '1200-1399', min: 1200, max: 1399 },
      { label: '1400-1599', min: 1400, max: 1599 },
      { label: '1600-1799', min: 1600, max: 1799 },
      { label: '1800-1999', min: 1800, max: 1999 },
      { label: '2000-2199', min: 2000, max: 2199 },
      { label: '2200+', min: 2200, max: 9999 }
    ];

    const lcRatings = await db.query(
      `SELECT lp.current_rating as rating FROM LeetCodeProfiles lp
       JOIN Users u ON u.id = lp.user_id
       WHERE u.status = 'active' AND lp.current_rating > 0`
    );

    const ccRatings = await db.query(
      `SELECT cp.current_rating as rating FROM CodeChefProfiles cp
       JOIN Users u ON u.id = cp.user_id
       WHERE u.status = 'active' AND cp.current_rating > 0`
    );

    const cfRatings = await db.query(
      `SELECT cfp.current_rating as rating FROM CodeforcesProfiles cfp
       JOIN Users u ON u.id = cfp.user_id
       WHERE u.status = 'active' AND cfp.current_rating > 0`
    );

    const buildDist = (rows) => bands.map(b => ({
      label: b.label,
      count: rows.filter(r => Number(r.rating) >= b.min && Number(r.rating) <= b.max).length
    }));

    const allRatings = [...lcRatings, ...ccRatings, ...cfRatings];

    return {
      leetcode: buildDist(lcRatings),
      codechef: buildDist(ccRatings),
      codeforces: buildDist(cfRatings),
      combined: buildDist(allRatings),
      bands: bands.map(b => b.label)
    };
  }, 15 * 60 * 1000);
}

/**
 * Get unified student profile data (all platforms).
 * @param {number} userId
 */
async function getUnifiedStudentProfile(userId) {
  const cacheKey = cache.KEYS.STUDENT_ANALYTICS(userId);
  return cache.getOrCompute(cacheKey, async () => {
    const [row] = await db.query(
      `SELECT u.id, u.name, u.roll_no, u.department, u.section, u.academic_batch,
              u.leetcode_username, u.codechef_username, u.codeforces_username, u.hackerrank_username,
              u.codeforces_verified, u.codeforces_verified_at, u.codeforces_verified_source,
              u.academic_start_date, u.academic_end_date,
              lp.current_rating as lc_rating, lp.highest_rating as lc_best_rating,
              lp.global_ranking as lc_rank, lp.problems_solved as lc_solved,
              lp.contest_history as lc_history,
              lp.active_days as lc_active_days, lp.submission_calendar as lc_submission_calendar,
              lp.badges as lc_badges, lp.language_stats as lc_language_stats,
              lp.topic_stats as lc_topic_stats, lp.recent_submissions as lc_recent_submissions,
              lp.easy_solved as lc_easy_solved, lp.medium_solved as lc_medium_solved,
              lp.hard_solved as lc_hard_solved, lp.acceptance_rate as lc_acceptance_rate,
              cp.current_rating as cc_rating, cp.highest_rating as cc_best_rating, cp.lowest_rating as cc_lowest_rating,
              cp.is_provisional as cc_is_provisional, cp.status as cc_status,
              cp.global_ranking as cc_rank, cp.country_rank as cc_country_rank,
              cp.problems_solved as cc_solved, cp.stars as cc_stars, cp.contest_history as cc_history, cp.rating_history as cc_rating_history,
              cfp.current_rating as cf_rating, cfp.highest_rating as cf_best_rating,
              cfp.rank as cf_rank, cfp.max_rank as cf_max_rank,
              cfp.problems_solved as cf_solved, cfp.contest_history as cf_history,
              hrp.problems_solved as hr_solved, hrp.stars as hr_stars,
              hrp.badges as hr_badges, hrp.certificates as hr_certs
       FROM Users u
       LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
       LEFT JOIN CodeChefProfiles cp ON u.id = cp.user_id
       LEFT JOIN CodeforcesProfiles cfp ON u.id = cfp.user_id
       LEFT JOIN HackerRankProfiles hrp ON u.id = hrp.user_id
       WHERE u.id = ?`,
      [userId]
    );

    if (!row) return null;
    
    const ccRatingHistory = (() => {
      try {
        return typeof row.cc_rating_history === 'string' ? JSON.parse(row.cc_rating_history) : (row.cc_rating_history || []);
      } catch {
        return [];
      }
    })();
    const ccLowestRating = row.cc_lowest_rating !== null ? Number(row.cc_lowest_rating) : null;
    const ccCurrentRating = row.cc_rating !== null ? Number(row.cc_rating) : null;
    const ccHighestRating = row.cc_best_rating !== null ? Number(row.cc_best_rating) : null;
    const ccIsProvisional = row.cc_is_provisional === 1;
    const ccStatus = row.cc_status || (ccCurrentRating !== null ? 'RATED' : 'UNRATED');
    const ccIsRated = ccCurrentRating !== null;

    // CodeChef rating history parsed from DB

    const lcHistory = parseContestHistory(row.lc_history).map(normalizeLeetCodeEntry).filter(e => e.attended);
    const ccHistory = parseContestHistory(row.cc_history).map(normalizeCodeChefEntry).filter(e => e.attended);
    const cfHistory = parseContestHistory(row.cf_history).map(normalizeCodeforcesEntry);

    const profiles = {
      leetcode: {
        platform: 'leetcode',
        verified: !!row.leetcode_username,
        username: row.leetcode_username,
        rating: Number(row.lc_rating) || null,
        maxRating: Number(row.lc_best_rating) || null,
        globalRanking: row.lc_rank || null,
        problemsSolved: Number(row.lc_solved) || 0,
        easySolved: Number(row.lc_easy_solved) || 0,
        mediumSolved: Number(row.lc_medium_solved) || 0,
        hardSolved: Number(row.lc_hard_solved) || 0,
        acceptanceRate: row.lc_acceptance_rate !== null ? Number(row.lc_acceptance_rate) : null,
        contests: lcHistory.length,
        contestHistory: lcHistory,
        activeDays: Number(row.lc_active_days) || 0,
        submissionCalendar: (() => { try { return typeof row.lc_submission_calendar === 'string' ? JSON.parse(row.lc_submission_calendar) : (row.lc_submission_calendar || {}); } catch { return {}; } })(),
        badges: (() => { try { return typeof row.lc_badges === 'string' ? JSON.parse(row.lc_badges) : (row.lc_badges || []); } catch { return []; } })(),
        languageStats: (() => { try { return typeof row.lc_language_stats === 'string' ? JSON.parse(row.lc_language_stats) : (row.lc_language_stats || []); } catch { return []; } })(),
        topicStats: (() => { try { return typeof row.lc_topic_stats === 'string' ? JSON.parse(row.lc_topic_stats) : (row.lc_topic_stats || []); } catch { return []; } })(),
        recentSubmissions: (() => { try { return typeof row.lc_recent_submissions === 'string' ? JSON.parse(row.lc_recent_submissions) : (row.lc_recent_submissions || []); } catch { return []; } })()
      },
      codechef: {
        platform: 'codechef',
        verified: !!row.codechef_username,
        username: row.codechef_username,
        rating: ccCurrentRating,
        maxRating: ccHighestRating,
        lowestRating: ccLowestRating,
        currentRating: ccCurrentRating,
        highestRating: ccHighestRating,
        isRated: ccIsRated,
        isProvisional: ccIsProvisional,
        status: ccStatus,
        globalRanking: row.cc_rank || null,
        countryRank: row.cc_country_rank || null,
        stars: row.cc_stars || null,
        problemsSolved: Number(row.cc_solved) || 0,
        contests: ccHistory.length,
        contestHistory: ccHistory,
        ratingHistory: ccRatingHistory
      },
      codeforces: {
        platform: 'codeforces',
        verified: row.codeforces_verified === 1 || row.codeforces_verified === true,
        verifiedAt: row.codeforces_verified_at || null,
        verifiedSource: row.codeforces_verified_source || null,
        username: row.codeforces_username,
        rating: Number(row.cf_rating) || null,
        maxRating: Number(row.cf_best_rating) || null,
        rank: row.cf_rank || null,
        maxRank: row.cf_max_rank || null,
        problemsSolved: Number(row.cf_solved) || 0,
        contests: cfHistory.length,
        contestHistory: cfHistory
      },
      hackerrank: {
        platform: 'hackerrank',
        verified: !!row.hackerrank_username,
        username: row.hackerrank_username,
        problemsSolved: Number(row.hr_solved) || 0,
        stars: Number(row.hr_stars) || 0,
        badges: (() => { try { return typeof row.hr_badges === 'string' ? JSON.parse(row.hr_badges) : (row.hr_badges || []); } catch { return []; } })(),
        certificates: (() => { try { return typeof row.hr_certs === 'string' ? JSON.parse(row.hr_certs) : (row.hr_certs || []); } catch { return []; } })()
      }
    };

    const overallScore = computeOverallScore(
      Number(row.lc_rating), Number(row.cc_rating), Number(row.cf_rating),
      Number(row.lc_solved), Number(row.cc_solved), Number(row.cf_solved), Number(row.hr_solved)
    );

    const totalProblemsSolved = Object.values(profiles).reduce((s, p) => s + (p.problemsSolved || 0), 0);

    return {
      student: {
        id: row.id,
        name: row.name,
        roll_no: row.roll_no,
        department: row.department,
        section: row.section,
        academic_batch: row.academic_batch,
        academic_start_date: row.academic_start_date,
        academic_end_date: row.academic_end_date,
        leetcode_username: row.leetcode_username || null,
        codechef_username: row.codechef_username || null,
        codeforces_username: row.codeforces_username || null,
        hackerrank_username: row.hackerrank_username || null,
        platforms: buildPlatformList(row)
      },
      profiles,
      overallScore,
      totalProblemsSolved
    };
  }, 10 * 60 * 1000);
}

module.exports = {
  getLeaderboards,
  getRatingDistribution,
  getUnifiedStudentProfile,
  buildPlatformList
};
