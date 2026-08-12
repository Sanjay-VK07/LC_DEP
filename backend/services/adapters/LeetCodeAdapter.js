const BaseAdapter = require('./BaseAdapter');
const LeetCodeConnector = require('../connectors/LeetCodeConnector');
const leetcodeUtils = require('../../utils/leetcode');
const db = require('../../config/db');
const { normalizeUsername } = require('../../utils/usernameNormalizer');

// Default cache TTL: 30 minutes (configurable via env)
const CACHE_TTL_MS = parseInt(process.env.PARTICIPANT_CACHE_TTL_MS, 10) || 30 * 60 * 1000;

// Rate-limit delay between page fetches (ms)
const PAGE_FETCH_DELAY_MS = parseInt(process.env.LEETCODE_PAGE_DELAY_MS, 10) || parseInt(process.env.PAGE_FETCH_DELAY_MS, 10) || 500;

// Concurrency limit for parallel page fetches
const PAGE_CONCURRENCY = parseInt(process.env.LEETCODE_PAGE_CONCURRENCY, 10) || parseInt(process.env.PAGE_FETCH_CONCURRENCY, 10) || 2;

// Default LeetCode ranking API page size (fallback if page 1 returns unexpected data)
const DEFAULT_PAGE_SIZE = 25;

// Minimum completeness ratio required before writing fetched data to cache.
// Prevents partial leaderboard fetches (due to page failures) from poisoning the cache.
const MIN_CACHE_COMPLETENESS = parseFloat(process.env.MIN_CACHE_COMPLETENESS) || 0.98;

class LeetCodeAdapter extends BaseAdapter {
  constructor() {
    super('LeetCode');
  }

  async getProfile(username) {
    try {
      const rawData = await LeetCodeConnector.fetchProfile(username);
      const normalized = LeetCodeConnector.normalize(rawData, username);
      return {
        ...normalized,
        rawData
      };
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('not found') || msg.includes('404') || msg.includes('does not exist') || msg.includes('invalid') || msg.includes('User not found')) {
        return {
          verified: false,
          message: err.message,
          platform: 'leetcode',
          username
        };
      }
      throw err;
    }
  }

  async getContestHistory(username) {
    try {
      const history = await LeetCodeConnector.fetchRatingHistory(username);
      return history.map(h => ({
        contestName: h.contestName,
        rating: h.rating,
        date: h.date ? new Date(h.date) : null,
        rank: h.rank,
        score: h.score || 0
      }));
    } catch (err) {
      console.error(`[LeetCodeAdapter] Error fetching contest history for ${username}:`, err.message);
      return [];
    }
  }

  /**
   * Fetch ALL contest participants with full leaderboard pagination,
   * TTL-based caching, partial-cache detection, and accurate fallback.
   *
   * @param {string|number} contestId - Contest ID or slug
   * @returns {Promise<Array<{username: string, rank: number|null, score: number|null, finishTime: number|null}>>}
   */
  /**
   * Helper to verify and format contest slug.
   * @param {string|number} contestId 
   * @returns {Promise<string>}
   */
  async _verifyAndFormatSlug(contestId) {
    let slug = contestId;
    if (typeof contestId === 'number' || (typeof contestId === 'string' && !isNaN(contestId) && contestId.trim() !== '')) {
      const rows = await db.query("SELECT slug FROM Contests WHERE contest_id = ?", [contestId]);
      if (rows.length > 0 && rows[0].slug) {
        slug = rows[0].slug;
      }
    }
    if (typeof slug === 'string') {
      slug = slug.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }
    return slug || String(contestId);
  }

  /**
   * Fetch ALL contest participants with full leaderboard pagination,
   * TTL-based caching, GraphQL fallback on 403 Cloudflare blocks, and accurate fallback.
   *
   * @param {string|number} contestId - Contest ID or slug
   * @returns {Promise<Array<{username: string, rank: number|null, score: number|null, finishTime: number|null}>>}
   */
  /**
   * Fetch ALL contest participants with full leaderboard pagination,
   * TTL-based caching, GraphQL batched fallback on Cloudflare blocks, and explicit SYNC_FAILED handling.
   *
   * @param {string|number} contestId - Contest ID or slug
   * @param {object} [options={}] - Options
   * @returns {Promise<Array<{username: string, rank: number|null, score: number|null, finishTime: number|null}>>}
   */
  async getContestParticipants(contestId, options = {}) {
    const startTime = Date.now();
    const slug = await this._verifyAndFormatSlug(contestId);
    const bypassCache = Boolean(options.bypassCache || options.forceRefresh);

    const cacheKey = `ContestParticipants:${slug}`;

    // ------------------------------------------------------------------
    // 1. Check ContestParticipants cache first unless bypassCache is set
    // ------------------------------------------------------------------
    const cacheResult = await this._checkCache(slug);
    if (!bypassCache && cacheResult.usable) {
      const elapsed = Date.now() - startTime;
      console.log(`[CACHE] [CACHE HIT] Cache Key: "${cacheKey}" | Rows: ${cacheResult.count} | Age: ${Math.round(cacheResult.ageMs / 1000)}s | Resolved in ${elapsed}ms`);
      const cachedList = cacheResult.participants;
      cachedList.pagesFetched = 1;
      cachedList.fromCache = true;
      cachedList.syncStatus = 'SUCCESS';
      cachedList.source = 'CACHE';
      return cachedList;
    }

    console.log(`[CACHE] [CACHE MISS] Cache Key: "${cacheKey}" | Reason: ${bypassCache ? 'bypassCache flag set' : cacheResult.reason}`);

    // ------------------------------------------------------------------
    // 2. Primary: Scrape live LeetCode ranking-page leaderboard directly
    // ------------------------------------------------------------------
    let liveScrapeError = null;
    try {
      console.log(`[LEADERBOARD] Fetching live leaderboard for contest "${slug}"...`);
      const { participants, pagesFetched, totalExpected } = await this._fetchFullLeaderboard(slug);
      if (participants && participants.length > 0) {
        await this._updateCache(slug, participants, true);
        const elapsed = Date.now() - startTime;
        console.log(`[LEADERBOARD] Contest "${slug}" resolved via live ranking-page scrape (${participants.length} participants, ${pagesFetched} pages) in ${elapsed}ms.`);
        participants.pagesFetched = pagesFetched;
        participants.totalExpected = totalExpected;
        participants.fromCache = false;
        participants.syncStatus = 'SUCCESS';
        participants.source = 'LEADERBOARD_API';
        return participants;
      }
    } catch (err) {
      liveScrapeError = err;
      if (err.code === 'CLOUDFLARE_BLOCK' || err.isCloudflare || err.status === 403) {
        console.warn(`[CLOUDFLARE_BLOCK] Leaderboard scrape blocked by Cloudflare (Status 403). Bypassing auth refresh and switching immediately to GraphQL fallback...`);
      } else if (err.status === 401) {
        console.warn(`[LEADERBOARD] HTTP 401 Unauthorized received. Attempting auth token refresh once...`);
        try {
          await leetcodeUtils.refreshLeetCodeAuthToken();
        } catch (_) {}
      } else {
        console.warn(`[LEADERBOARD] Live leaderboard scrape failed for "${slug}": ${err.message}. Attempting GraphQL fallback...`);
      }
    }

    // ------------------------------------------------------------------
    // 3. Secondary Fallback: Batched GraphQL per-user participation check
    // ------------------------------------------------------------------
    let gqlResult = null;
    let gqlParticipants = [];
    try {
      gqlResult = await this._fetchViaGraphQLFallback(slug, options.students);
      gqlParticipants = gqlResult.participants || [];

      if (gqlResult.isComplete && gqlParticipants.length > 0) {
        await this._updateCache(slug, gqlParticipants, true);
        const elapsed = Date.now() - startTime;
        console.log(`[GRAPHQL_FALLBACK] Contest "${slug}" resolved via GraphQL fallback (${gqlParticipants.length} participants, status: SUCCESS) in ${elapsed}ms.`);
        gqlParticipants.pagesFetched = 1;
        gqlParticipants.totalExpected = gqlParticipants.length;
        gqlParticipants.fromCache = false;
        gqlParticipants.syncStatus = 'SUCCESS';
        gqlParticipants.source = 'GRAPHQL_BATCH';
        gqlParticipants.resolvedCount = gqlResult.resolvedCount;
        gqlParticipants.unresolvedCount = 0;
        gqlParticipants.unresolvedUsernames = [];
        return gqlParticipants;
      }
    } catch (gqlErr) {
      console.warn(`[GRAPHQL_FALLBACK] GraphQL fallback failed for "${slug}": ${gqlErr.message}. Attempting alfa-leetcode-api fallback...`);
    }

    // ------------------------------------------------------------------
    // 4. Tertiary Fallback: alfa-leetcode-api fallback for remaining/unresolved handles
    // ------------------------------------------------------------------
    const unresolvedHandles = gqlResult?.unresolvedUsernames || (options.students || []).map(s => normalizeUsername(s.leetcode_username || s.username)).filter(Boolean);
    if (unresolvedHandles.length > 0 || gqlParticipants.length === 0) {
      try {
        const alfaResult = await this._fetchViaAlfaApiFallback(slug, unresolvedHandles);
        const alfaParticipants = alfaResult.participants || [];

        if (alfaParticipants.length > 0) {
          const combinedParticipants = [...gqlParticipants, ...alfaParticipants];
          const isComplete = (gqlResult?.resolvedCount || 0) + alfaResult.resolvedCount >= (options.students?.length || combinedParticipants.length);
          await this._updateCache(slug, combinedParticipants, isComplete);

          const elapsed = Date.now() - startTime;
          const status = isComplete ? 'SUCCESS' : 'PARTIAL';
          const source = gqlParticipants.length > 0 ? 'GRAPHQL_BATCH_ALFA_HYBRID' : 'ALFA_LEETCODE_API';

          console.log(`[ALFA_API_FALLBACK] Contest "${slug}" resolved via alfa-leetcode-api (${combinedParticipants.length} total participants, status: ${status}) in ${elapsed}ms.`);
          combinedParticipants.pagesFetched = 1;
          combinedParticipants.fromCache = false;
          combinedParticipants.syncStatus = status;
          combinedParticipants.source = source;
          combinedParticipants.resolvedCount = combinedParticipants.length;
          combinedParticipants.unresolvedCount = alfaResult.unresolvedCount;
          combinedParticipants.unresolvedUsernames = alfaResult.unresolvedUsernames;
          return combinedParticipants;
        }
      } catch (alfaErr) {
        console.warn(`[ALFA_API_FALLBACK] alfa-leetcode-api fallback failed for "${slug}": ${alfaErr.message}.`);
      }
    }

    // If GraphQL returned partial results without Alfa resolving the rest, return PARTIAL
    if (gqlParticipants.length > 0) {
      await this._updateCache(slug, gqlParticipants, false);
      const elapsed = Date.now() - startTime;
      console.log(`[GRAPHQL_FALLBACK] Contest "${slug}" resolved partially via GraphQL fallback (${gqlParticipants.length} participants, status: PARTIAL) in ${elapsed}ms.`);
      gqlParticipants.pagesFetched = 1;
      gqlParticipants.fromCache = false;
      gqlParticipants.syncStatus = 'PARTIAL';
      gqlParticipants.source = 'GRAPHQL_BATCH';
      gqlParticipants.resolvedCount = gqlResult.resolvedCount;
      gqlParticipants.unresolvedCount = gqlResult.unresolvedCount;
      gqlParticipants.unresolvedUsernames = gqlResult.unresolvedUsernames;
      return gqlParticipants;
    }

    // ------------------------------------------------------------------
    // 5. All participant sources failed -> NO FALSE ZERO RULE
    // ------------------------------------------------------------------
    console.error(`[SYNC_FAILED] Upstream participant data unavailable for contest "${slug}". All external sources failed.`);
    const syncError = new Error(`Contest sync failed for '${slug}': Upstream participant data unavailable from LeetCode leaderboard API, GraphQL fallback, and alfa-leetcode-api.`);
    syncError.code = 'SYNC_FAILED';
    syncError.syncStatus = 'SYNC_FAILED';
    syncError.contestSlug = slug;
    syncError.participants = [];
    throw syncError;
  }

  /**
   * Secondary Fallback: Queries contest history from alfa-leetcode-api for unresolved student handles
   * @private
   */
  async _fetchViaAlfaApiFallback(slug, handles = []) {
    if (!handles || handles.length === 0) return { participants: [], resolvedCount: 0, unresolvedCount: 0, unresolvedUsernames: [] };

    console.log(`[ALFA_API_FALLBACK] Querying alfa-leetcode-api for ${handles.length} unresolved student handles for contest "${slug}"...`);

    const participants = [];
    const unresolvedUsernames = [];
    const targetSlug = slug.toLowerCase();
    const slugify = (str) => (str || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    const CONCURRENCY = parseInt(process.env.ALFA_API_CONCURRENCY, 10) || 5;
    let handleIndex = 0;

    const worker = async () => {
      while (handleIndex < handles.length) {
        const username = handles[handleIndex++];
        if (!username) continue;

        try {
          const history = await leetcodeUtils.fetchContestHistoryFromAlfaApi(username);
          // STRICT CONTEST MATCHING
          const match = history.find(h => {
            if (!h || !h.attended) return false;
            const hTitle = h.contest?.title || '';
            const hSlug = h.contest?.titleSlug || slugify(hTitle);
            return hSlug === targetSlug || slugify(hTitle) === targetSlug;
          });

          if (match) {
            const rank = match.ranking || null;
            const problemsSolved = match.problemsSolved ?? 0;
            const score = Number.parseFloat((problemsSolved * 5.0).toFixed(2));
            const finishTime = match.finishTimeInSeconds || 0;

            participants.push({
              username,
              rank: Number.isFinite(rank) ? rank : null,
              score: Number.isFinite(score) ? score : 0.00,
              problemsSolved,
              finishTime
            });
          } else {
            unresolvedUsernames.push(username);
          }
        } catch (err) {
          console.warn(`[ALFA_API_FALLBACK] Error fetching ${username} from alfa-leetcode-api:`, err.message);
          unresolvedUsernames.push(username);
        }
      }
    };

    const pool = [];
    for (let i = 0; i < Math.min(CONCURRENCY, handles.length); i++) {
      pool.push(worker());
    }
    await Promise.all(pool);

    const resolvedCount = participants.length;
    const unresolvedCount = unresolvedUsernames.length;

    console.log(`[ALFA_API_FALLBACK] Resolved ${resolvedCount} attending participants out of ${handles.length} handles (${unresolvedCount} unresolved).`);

    return {
      participants,
      resolvedCount,
      unresolvedCount,
      unresolvedUsernames
    };
  }

  /**
   * GraphQL Fallback: Queries userContestRankingHistory in batches (25-50 handles per request)
   * when live leaderboard API returns 403 or Cloudflare challenge pages.
   * @private
   */
  async _fetchViaGraphQLFallback(slug, optionsStudents = null) {
    console.log(`[GRAPHQL_FALLBACK] Initiating batched student participation fallback for contest "${slug}"...`);
    
    let activeHandles = [];
    if (Array.isArray(optionsStudents) && optionsStudents.length > 0) {
      activeHandles = optionsStudents
        .map(s => normalizeUsername(s.leetcode_username || s.username))
        .filter(Boolean);
    }

    if (activeHandles.length === 0) {
      const activeRows = await db.query("SELECT leetcode_username FROM Users WHERE status = 'active'");
      activeHandles = activeRows
        .map(r => normalizeUsername(r.leetcode_username))
        .filter(Boolean);
    }

    activeHandles = Array.from(new Set(activeHandles));

    if (activeHandles.length === 0) {
      console.warn(`[GRAPHQL_FALLBACK] No active student handles found.`);
      return { participants: [], resolvedCount: 0, unresolvedCount: 0, unresolvedUsernames: [], isComplete: false };
    }

    const participants = [];
    const unresolvedUsernames = [];
    const targetSlug = slug.toLowerCase();
    const slugify = (str) => (str || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    // Batch handles in chunks of 25 users per single GraphQL HTTP POST query
    const BATCH_SIZE = parseInt(process.env.LEETCODE_GRAPHQL_BATCH_SIZE, 10) || 25;
    const batches = [];
    for (let i = 0; i < activeHandles.length; i += BATCH_SIZE) {
      batches.push(activeHandles.slice(i, i + BATCH_SIZE));
    }

    console.log(`[GRAPHQL_BATCH] Processing ${activeHandles.length} handles across ${batches.length} batches (Batch Size: ${BATCH_SIZE})...`);

    const CONCURRENCY = parseInt(process.env.LEETCODE_GRAPHQL_CONCURRENCY, 10) || 4;
    let batchIndex = 0;

    const worker = async () => {
      while (batchIndex < batches.length) {
        const currentBatch = batches[batchIndex++];
        if (!currentBatch || currentBatch.length === 0) continue;

        try {
          const batchResults = await leetcodeUtils.getBatchUserContestRankingHistory(currentBatch);
          
          for (const username of currentBatch) {
            const history = batchResults[username] || [];
            // STRICT CONTEST MATCHING: contest.titleSlug === targetSlug or slugify(contest.title) === targetSlug
            const match = history.find(h => {
              if (!h || !h.attended) return false;
              const hTitle = h.contest?.title || '';
              const hSlug = h.contest?.titleSlug || slugify(hTitle);
              return hSlug === targetSlug || slugify(hTitle) === targetSlug;
            });

            if (match) {
              const rank = match.ranking || null;
              const problemsSolved = match.problemsSolved ?? 0;
              const score = Number.parseFloat((problemsSolved * 5.0).toFixed(2));
              const finishTime = match.finishTimeInSeconds || 0;

              participants.push({
                username,
                rank: Number.isFinite(rank) ? rank : null,
                score: Number.isFinite(score) ? score : 0.00,
                problemsSolved,
                finishTime
              });
            }
          }
        } catch (err) {
          console.warn(`[GRAPHQL_BATCH] Batch query failed for ${currentBatch.length} handles: ${err.message}`);
          unresolvedUsernames.push(...currentBatch);
        }
      }
    };

    const pool = [];
    for (let i = 0; i < Math.min(CONCURRENCY, batches.length); i++) {
      pool.push(worker());
    }
    await Promise.all(pool);

    const resolvedCount = participants.length;
    const unresolvedCount = unresolvedUsernames.length;
    const isComplete = unresolvedCount === 0;

    console.log(`[GRAPHQL_FALLBACK] Resolved ${resolvedCount} attending participants out of ${activeHandles.length} total handles (${unresolvedCount} unresolved).`);
    
    return {
      participants,
      resolvedCount,
      unresolvedCount,
      unresolvedUsernames,
      isComplete
    };
  }

  /**
   * Check if the ContestParticipants cache is fresh and complete.
   *
   * Completeness guarantee: _updateCache() performs an atomic DELETE + INSERT
   * inside a single transaction, so the cache is either fully populated from
   * the last successful fetch or completely empty. A TTL-valid, non-empty
   * cache is therefore always complete — no arbitrary row-count heuristic needed.
   * @private
   */
  async _checkCache(slug) {
    const dbParticipants = await db.query(
      "SELECT username, `rank`, score, problems_solved, finish_time, updated_at FROM ContestParticipants WHERE contest_slug = ? ORDER BY `rank` ASC",
      [slug]
    );

    if (dbParticipants.length === 0) {
      console.log(`[LeetCodeAdapter] [CACHE] Contest: "${slug}" | Status: EMPTY`);
      return { usable: false, count: 0, reason: 'empty', participants: [], ageMs: Infinity };
    }

    // Determine cache age from the most recent updated_at
    const latestUpdate = dbParticipants.reduce((max, row) => {
      const ts = new Date(row.updated_at).getTime();
      return ts > max ? ts : max;
    }, 0);
    const ageMs = Date.now() - latestUpdate;

    // Check TTL
    if (ageMs > CACHE_TTL_MS) {
      console.log(`[LeetCodeAdapter] [CACHE] Contest: "${slug}" | Status: EXPIRED | Rows: ${dbParticipants.length} | Age: ${Math.round(ageMs / 1000)}s | TTL: ${CACHE_TTL_MS / 1000}s`);
      return { usable: false, count: dbParticipants.length, reason: `expired (age: ${Math.round(ageMs / 1000)}s, TTL: ${CACHE_TTL_MS / 1000}s)`, participants: [], ageMs };
    }

    // Cache is TTL-valid and non-empty.
    // Atomic _updateCache guarantees consistency, and the completeness guard
    // in getContestParticipants() ensures only complete fetches are cached.
    const participants = dbParticipants.map(p => {
      const parsedScore = Number.parseFloat(p.score);
      return {
        username: normalizeUsername(p.username),
        rank: p.rank,
        score: Number.isFinite(parsedScore) ? parsedScore : 0.00,
        problemsSolved: p.problems_solved || 0,
        finishTime: p.finish_time
      };
    });

    console.log(`[LeetCodeAdapter] [CACHE] Contest: "${slug}" | Status: FRESH | Rows: ${participants.length} | Age: ${Math.round(ageMs / 1000)}s`);
    return { usable: true, count: participants.length, reason: 'fresh', participants, ageMs };
  }

  /**
   * Fetch ALL leaderboard pages from the LeetCode contest ranking API.
   * Merges pages, deduplicates by normalized username, preserves rank/score/finishTime.
   * @private
   */
  async _fetchFullLeaderboard(slug) {
    // 1. Fetch page 1 to verify contest accessibility and get total participant count
    let page1Data;
    let page1Attempts = 0;
    const maxPage1Attempts = 3;
    while (page1Attempts < maxPage1Attempts) {
      page1Attempts++;
      try {
        page1Data = await leetcodeUtils.getContestRankingPage(slug, 1);
        if (page1Data) break;
      } catch (err) {
        const isCloudflare = err.name === 'CloudflareBlockedError' || err.isCloudflare || err.code === 'CLOUDFLARE_BLOCK' || err.status === 403 || err.retryable === false;
        if (isCloudflare) {
          console.warn(`[CLOUDFLARE_BLOCK] Leaderboard page 1 blocked by Cloudflare (Status ${err.status || 403}). Stopping retries and switching immediately to GraphQL fallback.`);
          err.code = 'CLOUDFLARE_BLOCK';
          err.status = err.status || 403;
          err.retryable = false;
          throw err;
        }
        if (page1Attempts < maxPage1Attempts) {
          const backoff = 1000 * Math.pow(2, page1Attempts);
          console.warn(`[LEADERBOARD] Page 1 fetch failed (attempt ${page1Attempts}/${maxPage1Attempts}): ${err.message}. Waiting ${backoff}ms...`);
          await new Promise(r => setTimeout(r, backoff));
        } else {
          if (err.status === 404 || (err.message && err.message.includes('404'))) {
            throw new Error(`Contest '${slug}' not found on LeetCode (HTTP 404). Please verify the contest slug.`);
          }
          throw new Error(`Failed to fetch page 1 for contest '${slug}': ${err.message}`);
        }
      }
    }

    if (!page1Data || page1Data.user_num === undefined || page1Data.user_num === null || page1Data.user_num <= 0 || !page1Data.total_rank || page1Data.total_rank.length === 0) {
      throw new Error(`Contest '${slug}' leaderboard is empty or has 0 participants. Verify contest has started and finished.`);
    }

    const totalUsers = page1Data.user_num || 0;
    const pageSize = page1Data.total_rank.length || DEFAULT_PAGE_SIZE;
    const totalPages = Math.ceil(totalUsers / pageSize);

    if (totalPages <= 0 || totalUsers <= 0) {
      throw new Error(`Contest '${slug}' leaderboard is empty or has 0 participants. Verify contest has started and finished.`);
    }

    // Get active students to support early-exit optimization
    const activeRows = await db.query("SELECT leetcode_username FROM Users WHERE status = 'active'");
    const activeHandles = new Set(activeRows.map(r => normalizeUsername(r.leetcode_username)).filter(Boolean));
    const matchedHandles = new Set();

    // Deduplicated participant map: normalized username → participant data
    const participantMap = new Map();

    // Process page 1 immediately
    this._mergePageIntoMap(participantMap, page1Data.total_rank, page1Data.submissions || [], activeHandles, matchedHandles);

    // Check if we already matched everyone on page 1
    if (activeHandles.size > 0 && matchedHandles.size >= activeHandles.size) {
      console.log(`[LeetCodeAdapter] Early-exit triggered: All ${activeHandles.size} active students matched on page 1.`);
      return {
        participants: Array.from(participantMap.values()),
        pagesFetched: 1,
        totalExpected: totalUsers
      };
    }

    // Set page ceiling to cover full contest unless LEETCODE_MAX_PAGES_LIMIT is explicitly defined
    const maxPagesCeiling = parseInt(process.env.LEETCODE_MAX_PAGES_LIMIT, 10) || totalPages;
    const pagesToFetchLimit = Math.min(totalPages, maxPagesCeiling);

    console.log(`[LeetCodeAdapter] Contest "${slug}": ${totalUsers} participants across ${totalPages} pages. Fetching up to ${pagesToFetchLimit} pages (Ceiling: ${maxPagesCeiling})...`);

    // ------------------------------------------------------------------
    // EXPLICIT PAGE TRACKING & ATOMIC QUEUE (Fixes race conditions & gaps)
    // ------------------------------------------------------------------
    const fetchedPages = new Set([1]);
    const inFlightPages = new Set();
    const permanentlyFailedPages = new Set();
    const fetchedPagesData = new Map();
    fetchedPagesData.set(1, page1Data);

    // Populate work queue with pages 2..pagesToFetchLimit
    const pageQueue = [];
    for (let p = 2; p <= pagesToFetchLimit; p++) {
      pageQueue.push(p);
    }

    let maxClaimedPage = 1;

    const runWorker = async (workerId) => {
      while (true) {
        // Early exit check: ONLY allowed if ALL active handles are matched,
        // NO pages are currently in-flight, and ALL pages up to maxClaimedPage are fetched cleanly.
        if (activeHandles.size > 0 && matchedHandles.size >= activeHandles.size) {
          if (inFlightPages.size === 0 && fetchedPages.size === maxClaimedPage) {
            console.log(`[LeetCodeAdapter] Early-exit condition satisfied cleanly at page ${maxClaimedPage}. All ${activeHandles.size} students matched.`);
            break;
          }
        }

        // Atomic shift: pull next unclaimed page from shared queue
        let currentPage;
        if (pageQueue.length > 0) {
          currentPage = pageQueue.shift();
          inFlightPages.add(currentPage);
          if (currentPage > maxClaimedPage) {
            maxClaimedPage = currentPage;
          }
        } else {
          // Queue is empty, exit worker loop
          break;
        }

        if (PAGE_FETCH_DELAY_MS > 0) {
          await new Promise(resolve => setTimeout(resolve, PAGE_FETCH_DELAY_MS));
        }

        let success = false;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts && !success) {
          attempts++;
          try {
            const data = await leetcodeUtils.getContestRankingPage(slug, currentPage);
            if (data && data.total_rank) {
              fetchedPagesData.set(currentPage, data);
              
              // Update matched handles
              for (const entry of data.total_rank) {
                const rawUsername = entry.user_slug || entry.username || '';
                const normUsername = normalizeUsername(rawUsername);
                if (activeHandles.has(normUsername)) {
                  matchedHandles.add(normUsername);
                }
              }

              success = true;
              inFlightPages.delete(currentPage);
              fetchedPages.add(currentPage);
            } else {
              throw new Error(`Empty response returned for page ${currentPage}`);
            }
          } catch (err) {
            if (attempts < maxAttempts) {
              const backoff = 1000 * attempts;
              await new Promise(resolve => setTimeout(resolve, backoff));
            } else {
              console.error(`[LeetCodeAdapter] Worker ${workerId}: Page ${currentPage} failed after ${maxAttempts} attempts: ${err.message}`);
              inFlightPages.delete(currentPage);
              permanentlyFailedPages.add(currentPage);
            }
          }
        }
      }
    };

    const workerCount = Math.min(PAGE_CONCURRENCY, pageQueue.length || 1);
    const workers = [];
    for (let i = 1; i <= workerCount; i++) {
      workers.push(runWorker(i));
    }
    await Promise.all(workers);

    // Retry Pass for permanently failed pages if any exist
    if (permanentlyFailedPages.size > 0) {
      const retryPages = Array.from(permanentlyFailedPages);
      console.warn(`[LeetCodeAdapter] Starting final retry pass for ${retryPages.length} failed pages: [${retryPages.join(', ')}]...`);
      await new Promise(resolve => setTimeout(resolve, 2000));

      for (const pageNum of retryPages) {
        try {
          const data = await leetcodeUtils.getContestRankingPage(slug, pageNum);
          if (data && data.total_rank) {
            fetchedPagesData.set(pageNum, data);
            permanentlyFailedPages.delete(pageNum);
            fetchedPages.add(pageNum);

            for (const entry of data.total_rank) {
              const rawUsername = entry.user_slug || entry.username || '';
              const normUsername = normalizeUsername(rawUsername);
              if (activeHandles.has(normUsername)) {
                matchedHandles.add(normUsername);
              }
            }
          }
        } catch (e) {
          console.error(`[LeetCodeAdapter] Page ${pageNum} failed final retry: ${e.message}`);
        }
      }
    }

    // ------------------------------------------------------------------
    // FINAL INTEGRITY CHECK BEFORE MARKING SYNC COMPLETE
    // ------------------------------------------------------------------
    const missingPages = [];
    for (let p = 1; p <= pagesToFetchLimit; p++) {
      if (!fetchedPages.has(p)) {
        missingPages.push(p);
      }
    }

    if (missingPages.length > 0) {
      const isEarlyExit = (activeHandles.size > 0 && matchedHandles.size >= activeHandles.size && maxClaimedPage < pagesToFetchLimit);
      if (!isEarlyExit) {
        const errorMsg = `Contest ranking scrape integrity failure for "${slug}": Scrape in-complete. Expected ${pagesToFetchLimit} pages, fetched ${fetchedPages.size}. Missing pages (${missingPages.length}): [${missingPages.slice(0, 10).join(', ')}${missingPages.length > 10 ? '...' : ''}]`;
        console.error(`[LeetCodeAdapter] ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }

    // Merge pages in strictly ascending numerical order (1..maxClaimedPage)
    for (let p = 1; p <= maxClaimedPage; p++) {
      if (!fetchedPagesData.has(p)) continue;
      const pageData = fetchedPagesData.get(p);
      if (pageData && pageData.total_rank) {
        this._mergePageIntoMap(participantMap, pageData.total_rank, pageData.submissions || [], activeHandles, matchedHandles);
      }
    }

    const participants = Array.from(participantMap.values());

    // Strict integrity check: totalPages, fetchedPages, and downloadedParticipants must be > 0
    if (totalPages <= 0 || participants.length <= 0 || fetchedPages.size <= 0) {
      const errStr = `Sync integrity assertion failed for contest '${slug}': totalPages (${totalPages}) and downloadedParticipants (${participants.length}) must be greater than 0.`;
      console.error(`[LeetCodeAdapter] ${errStr}`);
      throw new Error(errStr);
    }

    console.log(`[LeetCodeAdapter] Scrape complete for "${slug}": ${participants.length} unique participants from ${fetchedPages.size} fetched pages (Expected: ${totalUsers}).`);

    return {
      participants,
      pagesFetched: fetchedPages.size,
      totalExpected: totalUsers
    };
  }

  /**
   * Merge a page of ranking data into the participant map.
   * Deduplicates by normalized username — later pages don't overwrite earlier (higher-ranked) entries.
   * @private
   */
  _mergePageIntoMap(map, rankEntries, submissionEntries = [], activeHandles = null, matchedHandles = null) {
    for (let i = 0; i < rankEntries.length; i++) {
      const entry = rankEntries[i];
      const rawUsername = entry.user_slug || entry.username || '';
      const normUsername = normalizeUsername(rawUsername);

      if (!normUsername) continue;

      if (activeHandles && matchedHandles && activeHandles.has(normUsername)) {
        matchedHandles.add(normUsername);
      }

      // Only insert if not already present (first occurrence has the correct rank)
      if (!map.has(normUsername)) {
        const parsedRank = Number.parseInt(entry.rank, 10);
        const parsedScore = Number.parseFloat(entry.score);
        const parsedFinishTime = Number.parseInt(entry.finish_time, 10);

        // Calculate solved count from submissions
        const userSubmissions = submissionEntries[i] || {};
        const solved = Object.values(userSubmissions).filter(s => s && (s.status === 10 || s.status === '10')).length;

        map.set(normUsername, {
          username: normUsername,
          rank: Number.isFinite(parsedRank) ? parsedRank : null,
          score: Number.isFinite(parsedScore) ? parsedScore : 0.00,
          finishTime: Number.isFinite(parsedFinishTime) ? parsedFinishTime : 0,
          problemsSolved: solved
        });
      }
    }
  }

  /**
   * Atomically update the ContestParticipants cache for a contest.
   * Uses a transaction to prevent partial cache states.
   * If isComplete is false (PARTIAL fetch), performs bulk upsert without wiping existing complete cache.
   * @private
   */
  async _updateCache(slug, participants, isComplete = true) {
    if (!participants || participants.length === 0) return;

    const pool = db.getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      if (isComplete) {
        // Full authoritative update: clear old cache within transaction
        await connection.query("DELETE FROM ContestParticipants WHERE contest_slug = ?", [slug]);
        
        const BATCH_SIZE = 500;
        for (let i = 0; i < participants.length; i += BATCH_SIZE) {
          const batch = participants.slice(i, i + BATCH_SIZE);
          const values = batch.map(p => [
            slug,
            p.username,
            p.rank ?? 0,
            Number.isFinite(p.score) ? p.score : 0.00,
            p.problemsSolved ?? 0,
            Number.isFinite(p.finishTime) ? p.finishTime : 0,
            null,  // avatar
            null,  // country
            0      // page_number
          ]);

          await connection.query(
            `INSERT INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, avatar, country, page_number)
             VALUES ?`,
            [values]
          );
        }
        console.log(`[CACHE_WRITE] Atomic cache replacement complete for "${slug}": ${participants.length} participants.`);
      } else {
        // Partial update: UPSERT resolved records without wiping complete cache
        const BATCH_SIZE = 500;
        for (let i = 0; i < participants.length; i += BATCH_SIZE) {
          const batch = participants.slice(i, i + BATCH_SIZE);
          const values = batch.map(p => [
            slug,
            p.username,
            p.rank ?? 0,
            Number.isFinite(p.score) ? p.score : 0.00,
            p.problemsSolved ?? 0,
            Number.isFinite(p.finishTime) ? p.finishTime : 0,
            null,  // avatar
            null,  // country
            0      // page_number
          ]);

          await connection.query(
            `INSERT INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, avatar, country, page_number)
             VALUES ?
             ON DUPLICATE KEY UPDATE
               \`rank\` = VALUES(\`rank\`),
               score = VALUES(score),
               problems_solved = VALUES(problems_solved),
               finish_time = VALUES(finish_time)`,
            [values]
          );
        }
        console.log(`[CACHE_WRITE] Atomic partial cache upsert complete for "${slug}": ${participants.length} participants.`);
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      console.error(`[CACHE_WRITE] Failed to update cache for "${slug}":`, err.message);
    } finally {
      connection.release();
    }
  }

  async getUpcomingContests() {
    try {
      const list = await leetcodeUtils.getRecentContests();
      const now = Math.floor(Date.now() / 1000);
      return list
        .filter(c => c.startTime > now)
        .map(c => ({
          title: c.title,
          slug: c.titleSlug,
          startTime: new Date(c.startTime * 1000),
          duration: c.duration,
          platform: 'LeetCode'
        }));
    } catch (err) {
      console.error('[LeetCodeAdapter] Error fetching upcoming contests:', err.message);
      return [];
    }
  }
}

module.exports = LeetCodeAdapter;
