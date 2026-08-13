const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { normalizeUsername } = require('./usernameNormalizer');

// Memory Cache for standings
const standingsCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Memory Cache for upcoming contests (discovery scans)
let upcomingContestsCache = null;
let upcomingContestsCacheTime = 0;
const UPCOMING_CONTESTS_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch standings from CLIST API or fall back to platform-specific mock/local data.
 * @param {string} platform - leetcode, codechef, codeforces, hackerrank
 * @param {string} contestSlug 
 * @returns {Promise<Array<{username: string, rank: number|null, score: number|null, penalty: number|null, finishTime: number|null, ratingChange: number|null}>>}
 */
async function fetchStandings(platform, contestSlug) {
  const plat = platform.toLowerCase();
  const cacheKey = `${plat}:${contestSlug}`;

  // 1. Check cache
  const cached = standingsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[Standings Provider] [CACHE HIT] Using cached standings for ${platform} contest: "${contestSlug}". Age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s`);
    return cached.data;
  }

  console.log(`[Standings Provider] Cache miss for ${platform} contest: "${contestSlug}". Fetching...`);

  // 2. Try CLIST API
  const ClistClient = require('../services/clist/ClistClient');
  if (ClistClient.isConfigured()) {
    try {
      let resource = '';
      if (plat === 'leetcode') resource = 'leetcode.com';
      else if (plat === 'codechef') resource = 'codechef.com';
      else if (plat === 'codeforces') resource = 'codeforces.com';
      else if (plat === 'hackerrank') resource = 'hackerrank.com';

      console.log(`[Standings Provider] [CLIST] Fetching standings for contest "${contestSlug}" (Resource: ${resource || 'all'})...`);
      const response = await ClistClient.getContestParticipants(contestSlug, { resource, limit: 1000 });

      if (response && response.objects && response.objects.length > 0) {
        standings = response.objects.map(obj => {
          const score = obj.solving !== undefined ? parseFloat(obj.solving) : null;
          const penalty = obj.penalty !== undefined ? parseInt(obj.penalty, 10) : null;
          const ratingChange = obj.rating_change !== undefined ? parseInt(obj.rating_change, 10) : null;

          return {
            username: normalizeUsername(obj.handle),
            rank: obj.place ? parseInt(obj.place, 10) : null,
            score: score,
            penalty: penalty,
            finishTime: penalty,
            ratingChange: ratingChange,
            platform: 'clist',
            provider: 'clist'
          };
        });
        console.log(`[Standings Provider] [CLIST] Successfully fetched ${standings.length} participants for "${contestSlug}".`);
      }
    } catch (err) {
      console.warn(`[Standings Provider] [CLIST Error] Failed to fetch statistics for "${contestSlug}":`, err.message);
    }
  }

  // 3. Fallback to local/mock standings
  if (!standings || standings.length === 0) {
    console.log(`[Standings Provider] CLIST standings unavailable. Falling back to local mock participants for "${contestSlug}"...`);
    try {
      const mockPath = path.join(__dirname, 'mock_entranthub_participants.json');
      if (fs.existsSync(mockPath)) {
        const mockData = JSON.parse(fs.readFileSync(mockPath, 'utf8'));
        const list = mockData[contestSlug] || [];
        if (list.length > 0) {
          standings = list.map((username, index) => ({
            username: normalizeUsername(username),
            rank: index + 1,
            score: 0.00,
            penalty: 0,
            finishTime: 0,
            ratingChange: 0
          }));
          console.log(`[Standings Provider] Loaded ${standings.length} mock participants for "${contestSlug}".`);
        }
      }
    } catch (mockErr) {
      console.error(`[Standings Provider] Mock fallback failed:`, mockErr.message);
    }
  }

  // 4. Update cache
  if (standings && standings.length > 0) {
    standingsCache.set(cacheKey, {
      timestamp: Date.now(),
      data: standings
    });
    return standings;
  }

  return [];
}

/**
 * Fetch upcoming contests from CLIST API or local mock data.
 * @returns {Promise<Array<{contest_name: string, contest_slug: string, contest_date: string, contest_status: string, contest_url: string}>>}
 */
async function fetchUpcomingContests() {
  if (upcomingContestsCache && (Date.now() - upcomingContestsCacheTime < UPCOMING_CONTESTS_TTL)) {
    console.log('[Standings Provider] [CACHE HIT] Using cached upcoming contests list.');
    return upcomingContestsCache;
  }

  const clistUser = process.env.CLIST_USERNAME;
  const clistKey = process.env.CLIST_API_KEY;
  let contests = null;

  if (clistUser && clistKey) {
    try {
      const url = `https://clist.by/api/v4/contest/?start__gt=${new Date().toISOString()}&order_by=start&limit=50`;
      console.log(`[Standings Provider] [CLIST Contests] Fetching: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Apikey ${clistUser}:${clistKey}`
        },
        timeout: 8000
      });

      if (response.data && response.data.objects && response.data.objects.length > 0) {
        contests = response.data.objects.map(c => ({
          contest_name: c.event,
          contest_slug: c.key || c.id.toString(),
          contest_date: c.start,
          contest_status: 'UPCOMING',
          contest_url: c.href
        }));
        console.log(`[Standings Provider] [CLIST Contests] Successfully fetched ${contests.length} upcoming contests.`);
      }
    } catch (err) {
      console.warn('[Standings Provider] [CLIST Contests Error] Failed to fetch contests:', err.message);
    }
  }

  if (!contests || contests.length === 0) {
    console.log('[Standings Provider] Falling back to local mock contests...');
    try {
      const mockPath = path.join(__dirname, 'mock_entranthub_contests.json');
      if (fs.existsSync(mockPath)) {
        const mockData = fs.readFileSync(mockPath, 'utf8');
        contests = JSON.parse(mockData);
      }
    } catch (err) {
      console.error('[Standings Provider] Mock contests fallback failed:', err.message);
    }
  }

  if (contests && contests.length > 0) {
    upcomingContestsCache = contests;
    upcomingContestsCacheTime = Date.now();
  }
  return contests || [];
}

module.exports = {
  fetchStandings,
  fetchUpcomingContests
};
