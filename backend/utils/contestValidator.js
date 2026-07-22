const NetworkService = require('./networkService');

const WEEKLY_REGEX = /^weekly-contest-(\d+)$/;
const BIWEEKLY_REGEX = /^biweekly-contest-(\d+)$/;
const HISTORICAL_WEEKLY_REGEX = /^leetcode-weekly-contest-(\d+)[a-b]?$/;
const APP_ACADEMY_SLUG = 'weekly-contest-by-app-academy';

let latestWeeklyContest = null;
let latestBiweeklyContest = null;
let upperBoundsEnabled = false;

/**
 * Extracts contest number from a slug.
 * @param {string} slug
 * @returns {number|null}
 */
function extractContestNumber(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const weeklyMatch = slug.match(WEEKLY_REGEX);
  if (weeklyMatch) return parseInt(weeklyMatch[1], 10);
  const biweeklyMatch = slug.match(BIWEEKLY_REGEX);
  if (biweeklyMatch) return parseInt(biweeklyMatch[1], 10);
  const histMatch = slug.match(HISTORICAL_WEEKLY_REGEX);
  if (histMatch) return parseInt(histMatch[1], 10);
  if (slug === APP_ACADEMY_SLUG) return 62;
  return null;
}

/**
 * Gets contest type (Weekly or Biweekly) from a slug.
 * @param {string} slug
 * @returns {string|null}
 */
function getContestType(slug) {
  if (!slug || typeof slug !== 'string') return null;
  if (WEEKLY_REGEX.test(slug) || HISTORICAL_WEEKLY_REGEX.test(slug) || slug === APP_ACADEMY_SLUG) return 'Weekly';
  if (BIWEEKLY_REGEX.test(slug)) return 'Biweekly';
  return null;
}

/**
 * Centralised isOfficialContest checks.
 * @param {string|object} contest
 * @returns {boolean}
 */
function isOfficialContest(contest) {
  if (!contest) return false;

  let slug = '';
  let title = '';

  if (typeof contest === 'string') {
    slug = contest;
  } else if (typeof contest === 'object') {
    slug = contest.slug || contest.contestSlug || contest.contest_slug || '';
    title = contest.title || contest.name || contest.contestName || contest.contest_name || '';
  }

  if (!slug || typeof slug !== 'string') return false;

  // Allow test / mock contests in test or development environments
  const isTestOrDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
  const isMock = slug.startsWith('test-') || slug.startsWith('mock-') || slug.startsWith('dummy-') || slug.startsWith('upcoming-live-');
  if (isMock && isTestOrDev) {
    return true;
  }

  // 1. Enforce official slug formats (including historical ones)
  const isWeekly = WEEKLY_REGEX.test(slug) || HISTORICAL_WEEKLY_REGEX.test(slug) || slug === APP_ACADEMY_SLUG;
  const isBiweekly = BIWEEKLY_REGEX.test(slug);
  if (!isWeekly && !isBiweekly) {
    return false;
  }

  // 2. Reject 999 fake contest patterns
  if (slug === 'weekly-contest-999' || slug === 'biweekly-contest-999' || slug.includes('999')) {
    return false;
  }
  if (title) {
    const titleLower = title.toLowerCase();
    if (titleLower.includes('999') || titleLower.includes('fake') || titleLower.includes('placeholder')) {
      return false;
    }
  }

  // 3. Extract and check contest number
  const num = extractContestNumber(slug);
  if (num === null || isNaN(num) || num <= 0) {
    return false;
  }

  // 4. Upper-bound validation check (if enabled)
  if (upperBoundsEnabled) {
    if (WEEKLY_REGEX.test(slug) && latestWeeklyContest !== null) {
      if (num > latestWeeklyContest + 3) {
        return false;
      }
    } else if (BIWEEKLY_REGEX.test(slug) && latestBiweeklyContest !== null) {
      if (num > latestBiweeklyContest + 3) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Verify from official source (LeetCode) that the contest exists.
 * Order: GraphQL contest list -> Contest API -> Ranking API -> Reject
 * @param {string} slug
 * @returns {Promise<boolean>}
 */
async function verifyContestExistsOnLeetCode(slug) {
  if (!isOfficialContest(slug)) return false;

  // Bypass existence verification for mock/test slugs in non-prod
  const isMock = slug.startsWith('test-') || slug.startsWith('mock-') || slug.startsWith('dummy-') || slug.startsWith('upcoming-live-');
  if (isMock) return true;

  // 1. GraphQL list check
  try {
    const contestsQuery = `
      query {
        allContests {
          titleSlug
        }
      }
    `;
    const postData = JSON.stringify({ query: contestsQuery });
    const graphQLUrl = 'https://leetcode.com/graphql/';
    const response = await NetworkService.request(graphQLUrl, {
      method: 'POST',
      body: postData,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://leetcode.com/'
      },
      timeout: 10000
    });

    if (response && response.data && response.data.allContests) {
      const exists = response.data.allContests.some(c => c.titleSlug === slug);
      if (exists) {
        console.log(`[ContestValidator] Verified existance of "${slug}" via GraphQL.`);
        return true;
      }
    }
  } catch (err) {
    console.warn(`[ContestValidator] GraphQL verification failed for "${slug}":`, err.message);
  }

  // 2. Contest info API check
  try {
    const infoUrl = `https://leetcode.com/contest/api/info/${slug}/`;
    const response = await NetworkService.request(infoUrl, {
      method: 'GET',
      timeout: 10000
    });
    if (response && response.contest) {
      console.log(`[ContestValidator] Verified existance of "${slug}" via Contest Info API.`);
      return true;
    }
  } catch (err) {
    console.warn(`[ContestValidator] Contest Info API verification failed for "${slug}":`, err.message);
  }

  // 3. Ranking API page 1 check
  try {
    const rankingUrl = `https://leetcode.com/contest/api/ranking/${slug}/?pagination=1`;
    const response = await NetworkService.request(rankingUrl, {
      method: 'GET',
      timeout: 10000
    });
    if (response && (response.total_rank || response.rank_rows)) {
      console.log(`[ContestValidator] Verified existance of "${slug}" via Ranking API.`);
      return true;
    }
  } catch (err) {
    console.warn(`[ContestValidator] Ranking API verification failed for "${slug}":`, err.message);
  }

  console.warn(`[ContestValidator] Verification failed on all official sources for: ${slug}`);
  return false;
}

/**
 * Dynamic Latest Contest Detection.
 * Fetches latest contests from LeetCode GraphQL, falls back to DB, and updates cached bounds.
 */
async function initializeValidator() {
  console.log('[ContestValidator] Initializing contest validator limits...');
  let lcWeeklyMax = 0;
  let lcBiweeklyMax = 0;
  let success = false;

  // 1. Try fetching from LeetCode GraphQL
  try {
    const queryStr = `
      query {
        allContests {
          titleSlug
        }
      }
    `;
    const postData = JSON.stringify({ query: queryStr });
    const response = await NetworkService.request('https://leetcode.com/graphql/', {
      method: 'POST',
      body: postData,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://leetcode.com/'
      },
      timeout: 8000
    });

    if (response && response.data && response.data.allContests) {
      for (const c of response.data.allContests) {
        const slug = c.titleSlug;
        const num = extractContestNumber(slug);
        if (num && num !== 999) {
          if (WEEKLY_REGEX.test(slug)) {
            lcWeeklyMax = Math.max(lcWeeklyMax, num);
          } else if (BIWEEKLY_REGEX.test(slug)) {
            lcBiweeklyMax = Math.max(lcBiweeklyMax, num);
          }
        }
      }
      if (lcWeeklyMax > 0 || lcBiweeklyMax > 0) {
        success = true;
        console.log(`[ContestValidator] Successfully fetched bounds from LeetCode GraphQL. Weekly max: ${lcWeeklyMax}, Biweekly max: ${lcBiweeklyMax}`);
      }
    }
  } catch (err) {
    console.warn('[ContestValidator] Failed to initialize limits from LeetCode GraphQL:', err.message);
  }

  // 2. Fallback to Database
  if (!success) {
    try {
      const dbPath = require('path').resolve(__dirname, '../config/db');
      const db = require(dbPath);
      if (db && typeof db.query === 'function') {
        const rows = await db.query(`
          SELECT contest_slug as slug FROM Contests 
          WHERE contest_slug LIKE 'weekly-contest-%' OR contest_slug LIKE 'biweekly-contest-%'
        `);
        for (const row of rows) {
          const slug = row.slug;
          const num = extractContestNumber(slug);
          if (num && num !== 999) {
            if (WEEKLY_REGEX.test(slug)) {
              lcWeeklyMax = Math.max(lcWeeklyMax, num);
            } else if (BIWEEKLY_REGEX.test(slug)) {
              lcBiweeklyMax = Math.max(lcBiweeklyMax, num);
            }
          }
        }
        if (lcWeeklyMax > 0 || lcBiweeklyMax > 0) {
          success = true;
          console.log(`[ContestValidator] Initialized bounds from local database. Weekly max: ${lcWeeklyMax}, Biweekly max: ${lcBiweeklyMax}`);
        }
      }
    } catch (err) {
      console.warn('[ContestValidator] Database query fallback failed:', err.message);
    }
  }

  // 3. Set limits or temporarily disable bounds check
  if (success) {
    latestWeeklyContest = lcWeeklyMax;
    latestBiweeklyContest = lcBiweeklyMax;
    upperBoundsEnabled = true;
  } else {
    // Disable upper bounds check
    latestWeeklyContest = null;
    latestBiweeklyContest = null;
    upperBoundsEnabled = false;
    console.warn('[ContestValidator] Both LeetCode and database bounds fetching failed. Upper-bound validation is temporarily disabled.');
  }
}

/**
 * Log helper for validation rejections.
 */
function logRejectedContest(slug, title, reason, source = 'validator') {
  const contestNumber = extractContestNumber(slug) || 0;
  const logObject = {
    slug: slug || 'unknown',
    title: title || 'unknown',
    contestNumber,
    source,
    reason,
    timestamp: new Date().toISOString()
  };
  console.warn(`Rejected contest: ${JSON.stringify(logObject, null, 2)}`);
}

module.exports = {
  isOfficialContest,
  extractContestNumber,
  getContestType,
  verifyContestExistsOnLeetCode,
  initializeValidator,
  logRejectedContest,
  getLatestWeekly: () => latestWeeklyContest,
  getLatestBiweekly: () => latestBiweeklyContest,
  isUpperBoundsEnabled: () => upperBoundsEnabled,
  // For test overrides
  setLatestWeekly: (val) => { latestWeeklyContest = val; upperBoundsEnabled = true; },
  setLatestBiweekly: (val) => { latestBiweeklyContest = val; upperBoundsEnabled = true; },
  setUpperBoundsEnabled: (val) => { upperBoundsEnabled = val; }
};
