const https = require('https');
const { exec } = require('child_process');
const NetworkService = require('./networkService');

/**
 * Generic helper to query LeetCode GraphQL API
 * @param {string} query - GraphQL query string
 * @param {object} variables - Query variables
 * @returns {Promise<object>} - Parse JSON response
 */
const CONCURRENCY_LIMIT = parseInt(process.env.LEETCODE_PAGE_CONCURRENCY, 10) || 2;
const PAGE_DELAY = parseInt(process.env.LEETCODE_PAGE_DELAY_MS, 10) || 500;
const MAX_RETRIES = parseInt(process.env.LEETCODE_MAX_RETRIES, 10) || 4;
const BACKOFF_BASE = parseInt(process.env.LEETCODE_BACKOFF_BASE_MS, 10) || 2000;

let activeRequestCount = 0;
const pendingQueue = [];

function throttleRequest(fn) {
  return new Promise((resolve, reject) => {
    pendingQueue.push({ fn, resolve, reject });
    processPendingQueue();
  });
}

function processPendingQueue() {
  if (activeRequestCount >= CONCURRENCY_LIMIT || pendingQueue.length === 0) {
    return;
  }
  const { fn, resolve, reject } = pendingQueue.shift();
  activeRequestCount++;
  
  fn().then(async (res) => {
    resolve(res);
    activeRequestCount--;
    if (PAGE_DELAY > 0) {
      await new Promise(r => setTimeout(r, PAGE_DELAY));
    }
    processPendingQueue();
  }).catch(async (err) => {
    reject(err);
    activeRequestCount--;
    if (PAGE_DELAY > 0) {
      await new Promise(r => setTimeout(r, PAGE_DELAY));
    }
    processPendingQueue();
  });
}

// Cached CSRF session cookie and auth token for the LeetCode GraphQL endpoint
let sessionCookie = null;
let cookieFetchPromise = null;
let authToken = process.env.LEETCODE_AUTH_TOKEN || null;

function fetchSessionCookie() {
  if (cookieFetchPromise) return cookieFetchPromise;
  cookieFetchPromise = new Promise((resolve) => {
    const req = https.request({
      hostname: 'leetcode.com',
      path: '/graphql/',
      method: 'GET',
      headers: { 'User-Agent': process.env.LEETCODE_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' },
      timeout: 10000
    }, (res) => {
      res.resume(); // drain body, we only need headers
      const setCookie = res.headers['set-cookie'] || [];
      const csrfLine = setCookie.find(c => c.startsWith('csrftoken'));
      if (csrfLine) {
        sessionCookie = csrfLine.split(';')[0];
      }
      cookieFetchPromise = null;
      resolve(sessionCookie);
    });
    req.on('error', () => { cookieFetchPromise = null; resolve(null); });
    req.on('timeout', () => { req.destroy(); cookieFetchPromise = null; resolve(null); });
    req.end();
  });
  return cookieFetchPromise;
}

/**
 * Refreshes stale CSRF session cookie and LeetCode auth token.
 * Can be called before sync jobs or automatically on token expiration errors.
 * @returns {Promise<{sessionCookie: string|null, authToken: string|null}>}
 */
async function refreshLeetCodeAuthToken() {
  console.log('[LeetCode API] Refreshing LeetCode session token and CSRF cookie...');
  sessionCookie = null;
  cookieFetchPromise = null;
  if (process.env.LEETCODE_AUTH_TOKEN) {
    authToken = process.env.LEETCODE_AUTH_TOKEN;
  }
  const newCookie = await fetchSessionCookie();
  return { sessionCookie: newCookie, authToken };
}

function isCsrfOrTokenFailure(statusCode, data) {
  const dataStr = typeof data === 'string' ? data.toLowerCase() : '';
  const isCsrf = statusCode === 403 && dataStr.includes('csrf');
  const isTokenExpired = statusCode === 401 || (statusCode === 403 && (
    dataStr.includes('authorization') ||
    dataStr.includes('token') ||
    dataStr.includes('unauthorized') ||
    dataStr.includes('expired') ||
    dataStr.includes('invalid')
  ));
  return isCsrf || isTokenExpired;
}

async function queryLeetCodeRaw(query, variables = {}, isCookieRetry = false) {
  if (!sessionCookie) {
    await fetchSessionCookie();
  }

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query, variables });

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'User-Agent': process.env.LEETCODE_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Referer': 'https://leetcode.com/'
    };
    if (sessionCookie) {
      headers['Cookie'] = sessionCookie;
      const csrfToken = sessionCookie.split('=')[1];
      if (csrfToken) {
        headers['x-csrftoken'] = csrfToken;
      }
    }
    const currentToken = authToken || process.env.LEETCODE_AUTH_TOKEN;
    if (currentToken) {
      headers['Authorization'] = currentToken.startsWith('Bearer ') ? currentToken : `Bearer ${currentToken}`;
    }

    const options = {
      hostname: 'leetcode.com',
      path: '/graphql/',
      method: 'POST',
      headers,
      timeout: 10000 // 10 seconds timeout
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', async () => {
        const isExpiredErr = isCsrfOrTokenFailure(res.statusCode, data);
        if (isExpiredErr && !isCookieRetry) {
          console.warn(`[LeetCode API] Token or CSRF validation failed (HTTP ${res.statusCode}). Refreshing token and retrying...`);
          await refreshLeetCodeAuthToken();
          try {
            resolve(await queryLeetCodeRaw(query, variables, true));
          } catch (e) {
            reject(e);
          }
          return;
        }

        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            if (json.errors && json.errors.length > 0) {
              const errMsg = json.errors[0].message || '';
              if ((errMsg.toLowerCase().includes('token') || errMsg.toLowerCase().includes('authorization') || errMsg.toLowerCase().includes('expired')) && !isCookieRetry) {
                console.warn(`[LeetCode API] GraphQL returned token error: "${errMsg}". Refreshing token and retrying...`);
                await refreshLeetCodeAuthToken();
                try {
                  resolve(await queryLeetCodeRaw(query, variables, true));
                } catch (e) {
                  reject(e);
                }
                return;
              }
              const err = new Error(errMsg);
              err.status = res.statusCode;
              reject(err);
            } else {
              resolve(json);
            }
          } catch (e) {
            const err = new Error(`Failed to parse LeetCode response: ${e.message}`);
            err.status = res.statusCode;
            reject(err);
          }
        } else {
          const err = new Error(`LeetCode API returned status code ${res.statusCode}`);
          err.status = res.statusCode;
          reject(err);
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Network error connecting to LeetCode: ${e.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('LeetCode GraphQL request timed out'));
    });

    req.write(postData);
    req.end();
  });
}

async function queryLeetCode(query, variables = {}, attempt = 1) {
  try {
    return await throttleRequest(() => queryLeetCodeRaw(query, variables));
  } catch (err) {
    const isRateLimit = err.status === 429 ||
                        (err.message && (
                          err.message.includes('429') ||
                          err.message.toLowerCase().includes('rate limit') ||
                          err.message.toLowerCase().includes('too many requests')
                        ));

    if (isRateLimit && attempt <= MAX_RETRIES + 1) {
      const baseDelay = BACKOFF_BASE * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 1000) + 500;
      const delay = baseDelay + jitter;

      console.warn(`[LeetCode API] Rate limit hit (Attempt ${attempt}/${MAX_RETRIES + 1}). Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return queryLeetCode(query, variables, attempt + 1);
    }
    throw err;
  }
}

/**
 * Verifies if a LeetCode username exists on LeetCode.com and retrieves basic ranking stats
 * @param {string} username - LeetCode username to verify
 * @returns {Promise<{exists: boolean, username?: string, rating?: number, globalRanking?: number, error?: string}>}
 */
async function verifyLeetCodeUsername(username) {
  if (!username || typeof username !== 'string') {
    return { exists: false, error: 'Invalid username' };
  }

  const trimmedUsername = username.trim();
  if (trimmedUsername === '') {
    return { exists: false, error: 'Username cannot be empty' };
  }

  const profileQuery = `
    query getUserProfile($username: String!) {
      matchedUser(username: $username) {
        username
      }
      userContestRanking(username: $username) {
        rating
        globalRanking
      }
    }
  `;

  try {
    const json = await queryLeetCode(profileQuery, { username: trimmedUsername });
    if (json.data && json.data.matchedUser) {
      const stats = json.data.userContestRanking || {};
      return {
        exists: true,
        username: json.data.matchedUser.username,
        rating: stats.rating ? Math.round(stats.rating) : null,
        globalRanking: stats.globalRanking || null
      };
    } else {
      return { exists: false };
    }
  } catch (err) {
    return { exists: false, error: err.message };
  }
}

/**
 * Fetches all recent contests list from LeetCode
 * @returns {Promise<Array<{title: string, titleSlug: string, startTime: number, duration: number}>>}
 */
async function getRecentContests() {
  const contestsQuery = `
    query {
      allContests {
        title
        titleSlug
        startTime
        duration
      }
    }
  `;

  try {
    const json = await queryLeetCode(contestsQuery);
    if (json.data && json.data.allContests) {
      // Filter out and clean up only Weekly and Biweekly contests
      return json.data.allContests.filter(c => 
        c.title.toLowerCase().startsWith('weekly contest') || 
        c.title.toLowerCase().startsWith('biweekly contest')
      );
    }
    return [];
  } catch (err) {
    console.error('[LeetCode Crawler] Error fetching recent contests:', err.message);
    throw err;
  }
}

/**
 * Fetches contest ranking and participation history for a single user
 * @param {string} username - LeetCode username
 * @returns {Promise<Array<{attended: boolean, problemsSolved: number, totalProblems: number, rating: number, ranking: number, contest: {title: string, startTime: number}}>>}
 */
async function getUserContestHistory(username) {
  const historyQuery = `
    query userContestRankingHistory($username: String!) {
      userContestRankingHistory(username: $username) {
        attended
        problemsSolved
        totalProblems
        rating
        ranking
        contest {
          title
          startTime
        }
      }
    }
  `;

  try {
    const json = await queryLeetCode(historyQuery, { username });
    if (json.data && json.data.userContestRankingHistory) {
      return json.data.userContestRankingHistory;
    }
    return [];
  } catch (err) {
    console.error(`[LeetCode Crawler] Error fetching contest history for ${username}:`, err.message);
    throw err;
  }
}

const LEADERBOARD_RPM = parseInt(process.env.LEETCODE_LEADERBOARD_REQUESTS_PER_MINUTE, 10) || 6000;
const LEADERBOARD_DELAY_MS = Math.ceil(60000 / LEADERBOARD_RPM);

let lastLeaderboardTime = 0;
const leaderboardQueue = [];
let isProcessingLeaderboardQueue = false;

function throttleLeaderboardRequest(fn) {
  return new Promise((resolve, reject) => {
    leaderboardQueue.push({ fn, resolve, reject });
    processLeaderboardQueue();
  });
}

async function processLeaderboardQueue() {
  if (isProcessingLeaderboardQueue || leaderboardQueue.length === 0) return;
  isProcessingLeaderboardQueue = true;

  while (leaderboardQueue.length > 0) {
    const now = Date.now();
    const elapsed = now - lastLeaderboardTime;
    if (elapsed < LEADERBOARD_DELAY_MS && lastLeaderboardTime > 0) {
      const waitMs = LEADERBOARD_DELAY_MS - elapsed;
      console.log(`[LEADERBOARD] Throttling leaderboard request (${LEADERBOARD_RPM} req/min). Waiting ${waitMs}ms...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
    lastLeaderboardTime = Date.now();

    const { fn, resolve, reject } = leaderboardQueue.shift();
    try {
      const result = await fn();
      resolve(result);
    } catch (err) {
      reject(err);
    }
  }

  isProcessingLeaderboardQueue = false;
}

/**
 * Fetches one page of contest ranking from LeetCode
 * @param {string} contestSlug - LeetCode contest slug
 * @param {number} page - Page number to fetch
 * @param {object} [options={}] - Additional options for network request
 * @returns {Promise<object>} - Page ranking data
 */
function getContestRankingPage(contestSlug, page = 1, options = {}) {
  const url = `https://leetcode.com/contest/api/ranking/${contestSlug}/?pagination=${page}`;
  const customHeaders = {
    'User-Agent': process.env.LEETCODE_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': `https://leetcode.com/contest/${contestSlug}/ranking/`
  };
  return NetworkService.request(url, {
    useCurlTransport: true,
    timeout: 15000,
    ...options,
    headers: {
      ...customHeaders,
      ...(options.headers || {})
    }
  });
}

/**
 * Fetches page 1 of contest ranking to check accessibility and get the top participant
 * @param {string} contestSlug - LeetCode contest slug
 * @returns {Promise<{accessible: boolean, topParticipant?: string, data?: object}>}
 */
async function getContestRankingPage1(contestSlug) {
  try {
    const data = await getContestRankingPage(contestSlug, 1);
    if (data && data.total_rank && data.total_rank.length > 0) {
      const topParticipant = data.total_rank[0].username;
      return { accessible: true, topParticipant, data };
    }
    return { accessible: true };
  } catch (err) {
    console.error(`[LeetCode Crawler] Contest ${contestSlug} ranking page 1 inaccessible:`, err.message);
    return { accessible: false };
  }
}

/**
 * Fetches comprehensive LeetCode statistics for a user
 * @param {string} username - LeetCode username
 * @returns {Promise<object>} - Object with solved counts, ratings, global rank, active days, etc.
 */
async function getUserLeetCodeStats(username) {
  if (!username || typeof username !== 'string') {
    return { success: false, error: 'Invalid username' };
  }
  const trimmedUsername = username.trim();
  if (trimmedUsername === '') {
    return { success: false, error: 'Username cannot be empty' };
  }

  const statsQuery = `
    query userLeetCodeStats($username: String!) {
      matchedUser(username: $username) {
        submitStats {
          acSubmissionNum {
            difficulty
            count
            submissions
          }
          totalSubmissionNum {
            difficulty
            count
            submissions
          }
        }
        badges {
          id
          name
          icon
          hoverText
          medal {
            slug
          }
          creationDate
        }
      }
      userContestRanking(username: $username) {
        rating
        globalRanking
        attendedContestsCount
      }
    }
  `;

  // Separate query for calendar — some accounts restrict this via privacy settings
  const calendarQuery = `
    query userCalendar($username: String!) {
      matchedUser(username: $username) {
        userCalendar {
          totalActiveDays
          submissionCalendar
        }
      }
    }
  `;

  try {
    const json = await queryLeetCode(statsQuery, { username: trimmedUsername });
    if (json.data && json.data.matchedUser) {
      const submitStats = json.data.matchedUser.submitStats?.acSubmissionNum || [];

      // Fetch calendar separately — silently skip if permission denied (private profile)
      let userCalendar = {};
      try {
        const calJson = await queryLeetCode(calendarQuery, { username: trimmedUsername });
        userCalendar = calJson?.data?.matchedUser?.userCalendar || {};
      } catch (calErr) {
        console.warn(`[LeetCode Stats] Calendar fetch skipped for ${trimmedUsername}: ${calErr.message}`);
      }

      const contestRanking = json.data.userContestRanking || {};
      const rawBadges = json.data.matchedUser.badges || [];

      const stats = json.data.matchedUser.submitStats?.acSubmissionNum || [];
      const easySolved = stats.find(s => s.difficulty === "Easy")?.count ?? 0;
      const mediumSolved = stats.find(s => s.difficulty === "Medium")?.count ?? 0;
      const hardSolved = stats.find(s => s.difficulty === "Hard")?.count ?? 0;
      const totalSolvedRaw = stats.find(s => s.difficulty === "All")?.count ?? 0;

      let totalSolved = totalSolvedRaw;
      if (totalSolved === 0) {
        totalSolved = easySolved + mediumSolved + hardSolved;
      }

      let parsedCalendar = {};
      if (userCalendar.submissionCalendar) {
        try {
          parsedCalendar = JSON.parse(userCalendar.submissionCalendar);
        } catch (e) {
          console.warn('[LeetCode Stats] Failed to parse submissionCalendar JSON:', e.message);
        }
      }

      const acAll = (json.data.matchedUser.submitStats?.acSubmissionNum || []).find(x => x.difficulty === 'All')?.submissions ?? 0;
      const totalAll = (json.data.matchedUser.submitStats?.totalSubmissionNum || []).find(x => x.difficulty === 'All')?.submissions ?? 0;
      const acceptanceRate = totalAll > 0 ? Number(((acAll / totalAll) * 100).toFixed(2)) : 0.0;

      const badgesList = rawBadges.map(b => ({
        id: b.id,
        name: b.name,
        icon: b.icon ? (b.icon.startsWith('/') ? 'https://leetcode.com' + b.icon : b.icon) : null,
        hoverText: b.hoverText,
        slug: b.medal?.slug || ''
      }));

      console.log(`[LeetCode Stats Diagnostics] Username: ${trimmedUsername} | Easy: ${easySolved} | Medium: ${mediumSolved} | Hard: ${hardSolved} | Total Solved: ${totalSolved}`);
      console.log('[LeetCode Stats Diagnostics] Raw submitStats:', JSON.stringify(json.data.matchedUser.submitStats));

      return {
        success: true,
        username: trimmedUsername,
        totalSolved,
        easySolved,
        mediumSolved,
        hardSolved,
        activeDays: userCalendar.totalActiveDays || 0,
        submissionCalendar: parsedCalendar,
        contestRating: contestRanking.rating ? Math.round(contestRanking.rating) : null,
        globalRanking: contestRanking.globalRanking || null,
        contestParticipationCount: contestRanking.attendedContestsCount || 0,
        badges: badgesList,
        acceptanceRate: acceptanceRate
      };
    } else {
      return { success: false, error: 'User not found on LeetCode' };
    }
  } catch (err) {
    console.error(`[LeetCode Stats] Error fetching stats for ${trimmedUsername}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Fetches recent submissions of a LeetCode user
 * @param {string} username - LeetCode username
 * @param {number} limit - Number of submissions to fetch (default: 100)
 * @returns {Promise<Array<{title: string, titleSlug: string, timestamp: string, statusDisplay: string, lang: string}>>}
 */
async function getUserSubmissions(username, limit = 100) {
  if (!username) return [];
  const submissionsQuery = `
    query recentSubmissionList($username: String!, $limit: Int) {
      recentSubmissionList(username: $username, limit: $limit) {
        title
        titleSlug
        timestamp
        statusDisplay
        lang
      }
    }
  `;

  try {
    const json = await queryLeetCode(submissionsQuery, { username, limit });
    if (json.data && json.data.recentSubmissionList) {
      return json.data.recentSubmissionList;
    }
    return [];
  } catch (err) {
    console.error(`[LeetCode Crawler] Error fetching submissions for ${username}:`, err.message);
    throw err;
  }
}

/**
 * Fetches userContestRanking details for a single user
 * @param {string} username - LeetCode username
 * @returns {Promise<object>} - userContestRanking object { rating, globalRanking, attendedContestsCount, etc. }
 */
async function getUserContestRanking(username) {
  const rankingQuery = `
    query userContestRanking($username: String!) {
      userContestRanking(username: $username) {
        attendedContestsCount
        rating
        globalRanking
        topPercentage
        totalParticipants
      }
    }
  `;
  try {
    const json = await queryLeetCode(rankingQuery, { username });
    if (json.data && json.data.userContestRanking) {
      return json.data.userContestRanking;
    }
    return null;
  } catch (err) {
    console.error(`[LeetCode Crawler] Error fetching contest ranking for ${username}:`, err.message);
    throw err;
  }
}

/**
 * Fetches combined userContestRanking and userContestRankingHistory for a user
 * @param {string} username - LeetCode username
 * @returns {Promise<{userContestRanking: object, userContestRankingHistory: Array}>}
 */
async function getUserContestRankingAndHistory(username) {
  if (!username) {
    return { userContestRanking: null, userContestRankingHistory: [] };
  }
  const query = `
    query getUserContestRankingAndHistory($username: String!) {
      userContestRanking(username: $username) {
        rating
        attendedContestsCount
        globalRanking
      }
      userContestRankingHistory(username: $username) {
        attended
        rating
        ranking
        problemsSolved
        totalProblems
        finishTimeInSeconds
        contest {
          title
          titleSlug
          startTime
        }
      }
    }
  `;

  try {
    const json = await queryLeetCode(query, { username });
    
    if (process.env.DEBUG_LEETCODE === 'true') {
      console.log(`[LeetCode API Debug] Received response for ${username}:`, json?.data ? 'OK' : 'No Data');
    }

    // Verification step
    if (json && json.data) {
      const history = json.data.userContestRankingHistory;
      if (!history || history.length === 0) {
        console.warn(`[Verification Alert] userContestRankingHistory is empty or null for ${username}`);
      } else {
        console.log(`[Verification Success] userContestRankingHistory loaded with ${history.length} records.`);
        
        // Verify: contest titles are returned, attended field exists, problemsSolved exists
        let missingTitles = false;
        let missingAttended = false;
        let missingSolved = false;

        history.forEach((h, idx) => {
          if (!h.contest || typeof h.contest.title !== 'string') {
            missingTitles = true;
          }
          if (h.attended === undefined || h.attended === null) {
            missingAttended = true;
          }
          if (h.problemsSolved === undefined || h.problemsSolved === null) {
            missingSolved = true;
          }
        });

        if (missingTitles) {
          console.warn("[Verification Alert] Some entries are missing contest titles.");
        } else {
          console.log("[Verification Success] Contest titles verified.");
        }

        if (missingAttended) {
          console.warn("[Verification Alert] Some entries are missing the 'attended' field.");
        } else {
          console.log("[Verification Success] Attended field verified.");
        }

        if (missingSolved) {
          console.warn("[Verification Alert] Some entries are missing 'problemsSolved' field.");
        } else {
          console.log("[Verification Success] problemsSolved field verified.");
        }
      }
    } else {
      console.warn(`[Verification Alert] GraphQL response has no data field for ${username}`);
    }

    return json.data || { userContestRanking: null, userContestRankingHistory: [] };
  } catch (err) {
    console.error(`[LeetCode Crawler] Error in getUserContestRankingAndHistory for ${username}:`, err.message);
    throw err;
  }
}

/**
 * Constructs a GraphQL batch query string for multiple usernames using field aliases.
 * @param {Array<string>} usernames 
 * @returns {string} GraphQL query string
 */
function buildBatchContestRankingQuery(usernames = []) {
  const cleanUsernames = Array.from(new Set(usernames.map(u => (u || '').trim()).filter(Boolean)));
  if (cleanUsernames.length === 0) return '';

  const queryFields = cleanUsernames.map((username, idx) => `
    user_${idx}: userContestRankingHistory(username: "${username.replace(/"/g, '\\"')}") {
      attended
      ranking
      score
      problemsSolved
      totalProblems
      finishTimeInSeconds
      contest {
        title
        titleSlug
        startTime
      }
    }
  `).join('\n');

  return `
    query getBatchUserContestRankingHistory {
      ${queryFields}
    }
  `;
}

/**
 * Fetches userContestRankingHistory for a batch of student usernames (up to 25-50 per call) in a single GraphQL query using aliases.
 * @param {Array<string>} usernames - List of LeetCode usernames
 * @returns {Promise<Object<string, Array>>} Map of username -> userContestRankingHistory array
 */
async function getBatchUserContestRankingHistory(usernames = []) {
  if (!usernames || usernames.length === 0) return {};

  const cleanUsernames = Array.from(new Set(usernames.map(u => (u || '').trim()).filter(Boolean)));
  if (cleanUsernames.length === 0) return {};

  const batchQuery = buildBatchContestRankingQuery(cleanUsernames);
  if (!batchQuery) return {};

  try {
    const json = await queryLeetCode(batchQuery);
    const resultMap = {};
    if (json && json.data) {
      cleanUsernames.forEach((username, idx) => {
        resultMap[username] = json.data[`user_${idx}`] || [];
      });
    }
    return resultMap;
  } catch (err) {
    console.error(`[LeetCode API] Error in getBatchUserContestRankingHistory for batch of ${cleanUsernames.length} users:`, err.message);
    throw err;
  }
}

module.exports = {
  queryLeetCode,
  refreshLeetCodeAuthToken,
  buildBatchContestRankingQuery,
  verifyLeetCodeUsername,
  getRecentContests,
  getUserContestHistory,
  getContestRankingPage,
  getContestRankingPage1,
  getUserLeetCodeStats,
  getUserSubmissions,
  getUserContestRanking,
  getUserContestRankingAndHistory,
  getBatchUserContestRankingHistory
};



