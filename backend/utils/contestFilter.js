/**
 * Contest Filter Utility
 * =======================
 * Centralised rules defining what represents a developer/test/regression contest.
 */

/**
 * Checks whether a contest object matches test/regression criteria.
 * @param {object} contest
 * @returns {boolean}
 */
function isTestContest(contest) {
  if (!contest) return false;

  // 1. Check database is_test flag
  const isTest = contest.is_test === 1 || contest.is_test === true || contest.is_test === '1';
  if (isTest) return true;

  // 2. Check title / name keywords
  const name = contest.title || contest.name || contest.contestName || contest.contest_name || '';
  const testNames = [
    'Regression Test',
    'Regression',
    'Test Contest',
    'Mock Contest',
    'Demo Contest',
    'Development',
    'Debug',
    'Sample Contest'
  ];
  if (name) {
    const upperName = name.toLowerCase();
    if (testNames.some(t => upperName.includes(t.toLowerCase()))) {
      return true;
    }
  }

  // 3. Check slug prefix keywords
  const slug = contest.slug || contest.contestSlug || contest.contest_slug || '';
  const testSlugPrefixes = [
    'test-',
    'mock-',
    'debug-',
    'demo-',
    'regression-'
  ];
  if (slug) {
    const lowerSlug = slug.toLowerCase();
    if (testSlugPrefixes.some(p => lowerSlug.startsWith(p))) {
      return true;
    }
  }

  // 4. Check platform source
  const source = contest.source || '';
  if (source) {
    const upperSource = source.toUpperCase();
    if (upperSource === 'TEST' || upperSource === 'MOCK') {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether a contest object represents a real production contest.
 * @param {object} contest
 * @returns {boolean}
 */
function isProductionContest(contest) {
  return !isTestContest(contest);
}

/**
 * Returns SQL WHERE clause fragment to filter production contests.
 * Checks both the is_test DB flag and all known test/mock/debug slug prefixes.
 * @param {string} alias - Table alias (e.g. 'c', 'lc')
 * @returns {string}
 */
function productionContestWhere(alias = 'c') {
  const a = alias;
  return `(
    COALESCE(${a}.is_test, 0) = 0
    AND ${a}.slug NOT LIKE 'test-%'
    AND ${a}.slug NOT LIKE '%-test-%'
    AND ${a}.slug NOT LIKE '%-test'
    AND ${a}.slug NOT LIKE 'mock-%'
    AND ${a}.slug NOT LIKE '%mock-%'
    AND ${a}.slug NOT LIKE 'dummy-%'
    AND ${a}.slug NOT LIKE '%dummy-%'
    AND ${a}.slug NOT LIKE 'retry-%'
    AND ${a}.slug NOT LIKE 'stale-%'
    AND ${a}.slug NOT LIKE 'crashed-%'
    AND ${a}.slug NOT LIKE 'regression-%'
    AND ${a}.slug NOT LIKE 'internal-%'
    AND ${a}.slug NOT LIKE 'debug-%'
    AND ${a}.slug NOT LIKE 'demo-%'
  )`;
}

module.exports = {
  isTestContest,
  isProductionContest,
  productionContestWhere
};
