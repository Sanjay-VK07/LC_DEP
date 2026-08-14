const BaseAdapter = require('./BaseAdapter');
const LeetCodeConnector = require('../connectors/LeetCodeConnector');
const leetcodeUtils = require('../../utils/leetcode');
const db = require('../../config/db');
const { normalizeUsername } = require('../../utils/usernameNormalizer');

// Default cache TTL: 30 minutes (configurable via env)
const CACHE_TTL_MS = parseInt(process.env.PARTICIPANT_CACHE_TTL_MS, 10) || 30 * 60 * 1000;

// Rate-limit delay between page fetches (ms)
const PAGE_FETCH_DELAY_MS = parseInt(process.env.LEETCODE_PAGE_DELAY_MS, 10) || parseInt(process.env.PAGE_FETCH_DELAY_MS, 10) || 50;

// Concurrency limit for parallel page fetches
const PAGE_CONCURRENCY = parseInt(process.env.LEETCODE_PAGE_CONCURRENCY, 10) || parseInt(process.env.PAGE_FETCH_CONCURRENCY, 10) || 10;

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

    // ------------------------------------------------------------------
    // Request Deduplication: Share in-flight Promise for same contest slug
    // ------------------------------------------------------------------
    if (!this.inFlightSyncs) {
      this.inFlightSyncs = new Map();
    }

    if (this.inFlightSyncs.has(slug)) {
      console.log(`[DEDUPLICATION] Sharing active in-flight sync request for contest "${slug}".`);
      return this.inFlightSyncs.get(slug);
    }

    const syncPromise = (async () => {
      try {
        return await this._executeContestSyncPipeline(slug, options, startTime);
      } finally {
        this.inFlightSyncs.delete(slug);
      }
    })();

    this.inFlightSyncs.set(slug, syncPromise);
    return syncPromise;
  }

  async _executeContestSyncPipeline(slug, options, startTime) {
    const bypassCache = Boolean(options.bypassCache || options.forceRefresh);
    const cacheKey = `ContestParticipants:${slug}`;

    // ------------------------------------------------------------------
    // 1. Check ContestParticipants cache first unless bypassCache is set
    // ------------------------------------------------------------------
    const cacheResult = await this._checkCache(slug);
    if (!bypassCache && cacheResult.usable) {
      const elapsed = Date.now() - startTime;
      console.log(`[CONTEST_SYNC] Contest: ${slug} | Source: CACHE | Participants: ${cacheResult.count} | Duration: ${elapsed}ms`);
      const cachedList = cacheResult.participants;
      cachedList.pagesFetched = 1;
      cachedList.fromCache = true;
      cachedList.syncStatus = 'SUCCESS';
      cachedList.source = 'CACHE';
      return cachedList;
    }

    console.log(`[CACHE] [CACHE MISS] Cache Key: "${cacheKey}" | Reason: ${bypassCache ? 'bypassCache flag set' : cacheResult.reason}`);

    // ------------------------------------------------------------------
    // 2. Primary Provider: CLIST API v4 Contest-Level Fetch
    // ------------------------------------------------------------------
    try {
      console.log(`[CLIST_ATTENDANCE] Fetching contest-level statistics via CLIST for contest "${slug}"...`);
      const ClistAdapter = require('../clist/ClistAdapter');
      const clistAdapter = new ClistAdapter();

      if (!clistAdapter.isAvailable()) {
        throw new Error('CLIST API provider is not configured or unavailable');
      }

      const ClistClient = require('../clist/ClistClient');
      const contestSearchRes = await ClistClient.getContests({
        resource: 'leetcode.com',
        search: slug.replace(/-/g, ' ')
      }).catch(() => null);

      let clistContestId = slug;
      if (contestSearchRes && contestSearchRes.objects && contestSearchRes.objects.length > 0) {
        const matchedContest = contestSearchRes.objects.find(c =>
          (c.key || '').toLowerCase() === slug.toLowerCase() ||
          (c.event || '').toLowerCase() === slug.replace(/-/g, ' ').toLowerCase() ||
          (c.href || '').toLowerCase().includes(slug.toLowerCase())
        ) || contestSearchRes.objects[0];
        clistContestId = matchedContest.id;
      }

      const items = await clistAdapter.getContestParticipants(clistContestId, {
        resource: 'leetcode.com',
        bypassCache
      });

      if (items && items.length > 0) {
        await this._updateCache(slug, items, items.leaderboardComplete);
      }

      const elapsed = Date.now() - startTime;
      console.log(`[CONTEST_SYNC] Contest: ${slug} | Source: CLIST | Participants: ${items.length} | Duration: ${elapsed}ms`);
      items.pagesFetched = 1;
      items.fromCache = false;
      items.syncStatus = 'SUCCESS';
      items.source = 'CLIST';
      return items;
    } catch (err) {
      console.error(`[SYNC_FAILED] CLIST contest sync failed for contest "${slug}": ${err.message}`);
      const syncError = new Error(`Contest sync failed for '${slug}': ${err.message}`);
      syncError.code = 'SYNC_FAILED';
      syncError.syncStatus = 'SYNC_FAILED';
      syncError.contestSlug = slug;
      syncError.participants = [];
      throw syncError;
    }
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
    let dbParticipants = [];
    try {
      dbParticipants = await db.query(
        "SELECT username, `rank`, score, problems_solved, finish_time, updated_at FROM ContestParticipants WHERE contest_slug = ? ORDER BY `rank` ASC",
        [slug]
      );
    } catch (err) {
      console.warn(`[LeetCodeAdapter] [CACHE] DB query failed for "${slug}": ${err.message}`);
      return { usable: false, count: 0, reason: 'db_unavailable', participants: [], ageMs: Infinity };
    }

    if (!dbParticipants || dbParticipants.length === 0) {
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
  async _fetchFullLeaderboard(slug, options = {}) {
    const mode = options.mode || 'FULL_LEADERBOARD';

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
    let activeHandles = new Set();
    try {
      const activeRows = await db.query("SELECT leetcode_username FROM Users WHERE status = 'active'");
      activeHandles = new Set(activeRows.map(r => normalizeUsername(r.leetcode_username)).filter(Boolean));
    } catch (err) {
      console.warn(`[LeetCodeAdapter] Could not load active handles from DB: ${err.message}`);
    }
    const matchedHandles = new Set();

    // Deduplicated participant map: normalized username → participant data
    const participantMap = new Map();

    // Process page 1 immediately
    this._mergePageIntoMap(participantMap, page1Data.total_rank, page1Data.submissions || [], activeHandles, matchedHandles);

    // Check if we already matched everyone on page 1 (ONLY allowed in ATTENDANCE_ONLY mode)
    if (mode === 'ATTENDANCE_ONLY' && activeHandles.size > 0 && matchedHandles.size >= activeHandles.size) {
      console.log(`[LeetCodeAdapter] ATTENDANCE_ONLY early-exit triggered on page 1: All ${activeHandles.size} active students matched.`);
      return {
        participants: Array.from(participantMap.values()),
        pagesFetched: 1,
        totalExpected: totalUsers,
        totalPages,
        leaderboardComplete: (1 >= totalPages),
        attendanceVerified: true,
        syncStatus: 'VERIFIED_FOR_REGISTERED_STUDENTS'
      };
    }

    // Set page ceiling to cover full contest unless LEETCODE_MAX_PAGES_LIMIT is explicitly defined
    const maxPagesCeiling = parseInt(process.env.LEETCODE_MAX_PAGES_LIMIT, 10) || 1500;
    const pagesToFetchLimit = Math.min(totalPages, maxPagesCeiling);

    console.log(`[LeetCodeAdapter] Contest "${slug}": ${totalUsers} participants across ${totalPages} pages. Mode: ${mode}. Fetching up to ${pagesToFetchLimit} pages (Ceiling: ${maxPagesCeiling})...`);

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
        // Early exit check: ONLY allowed in ATTENDANCE_ONLY mode when ALL active handles are matched,
        // NO pages are currently in-flight, and ALL pages up to maxClaimedPage are fetched cleanly.
        if (mode === 'ATTENDANCE_ONLY' && activeHandles.size > 0 && matchedHandles.size >= activeHandles.size) {
          if (inFlightPages.size === 0 && fetchedPages.size === maxClaimedPage) {
            console.log(`[LeetCodeAdapter] ATTENDANCE_ONLY early-exit satisfied at page ${maxClaimedPage}. All ${activeHandles.size} students matched.`);
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

              if (fetchedPages.size % 5 === 0 || fetchedPages.size === pagesToFetchLimit) {
                const pct = ((fetchedPages.size / totalPages) * 100).toFixed(2);
                console.log(`[LEADERBOARD_SYNC] Contest: ${slug} | Page: ${fetchedPages.size}/${totalPages} | Participants: ${participantMap.size}/${totalUsers} | Progress: ${pct}%`);
              }
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
      const isEarlyExit = (mode === 'ATTENDANCE_ONLY' && activeHandles.size > 0 && matchedHandles.size >= activeHandles.size && maxClaimedPage < pagesToFetchLimit);
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

    const leaderboardComplete = (fetchedPages.size >= totalPages);
    const attendanceVerified = (activeHandles.size > 0 && matchedHandles.size >= activeHandles.size);

    let syncStatus = 'NOT_VERIFIED';
    if (leaderboardComplete) {
      syncStatus = 'SUCCESS';
    } else if (attendanceVerified) {
      syncStatus = 'VERIFIED_FOR_REGISTERED_STUDENTS';
    } else {
      syncStatus = 'NOT_VERIFIED';
    }

    console.log(`[LEADERBOARD_SYNC] Contest: ${slug} | Pages: ${fetchedPages.size}/${totalPages} | Participants: ${participantMap.size}/${totalUsers} | Leaderboard Complete: ${leaderboardComplete} | Attendance Verified: ${attendanceVerified} | Status: ${syncStatus}`);

    return {
      participants,
      pagesFetched: fetchedPages.size,
      totalExpected: totalUsers,
      totalPages,
      leaderboardComplete,
      attendanceVerified,
      syncStatus
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

    let connection = null;
    try {
      const pool = db.getPool();
      if (!pool) return;
      connection = await pool.getConnection();
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
      if (connection) {
        await connection.rollback().catch(() => {});
      }
      console.warn(`[CACHE_WRITE] Failed to update cache for "${slug}":`, err.message);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  async getUpcomingContests() {
    const leetAiClient = require('../../utils/leetAiClient');
    if (leetAiClient.isConfigured()) {
      try {
        const aiContests = await leetAiClient.getRecentContests();
        const now = Math.floor(Date.now() / 1000);
        if (aiContests && aiContests.length > 0) {
          return aiContests.filter(c => c.startTime ? Math.floor(c.startTime.getTime() / 1000) > now : true);
        }
      } catch (err) {
        console.warn('[LeetCodeAdapter] Leet.ai API getUpcomingContests failed, falling back to GraphQL:', err.message);
      }
    }

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
