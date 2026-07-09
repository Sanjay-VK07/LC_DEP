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
  async getContestParticipants(contestId) {
    const startTime = Date.now();
    let slug = contestId;

    // Resolve numeric ID to slug
    if (typeof contestId === 'number' || !isNaN(contestId)) {
      const rows = await db.query("SELECT slug FROM Contests WHERE contest_id = ?", [contestId]);
      if (rows.length > 0) {
        slug = rows[0].slug;
      }
    }

    // ------------------------------------------------------------------
    // 1. Check ContestParticipants cache with TTL and completeness check
    // ------------------------------------------------------------------
    const cacheResult = await this._checkCache(slug);

    if (cacheResult.usable) {
      const elapsed = Date.now() - startTime;
      console.log(`[LeetCodeAdapter] [DIAGNOSTICS] Contest: "${slug}" | Cache: HIT (${cacheResult.count} participants, age: ${Math.round(cacheResult.ageMs / 1000)}s) | Time: ${elapsed}ms`);
      return cacheResult.participants;
    }

    if (cacheResult.count > 0) {
      console.log(`[LeetCodeAdapter] Cache for "${slug}" is ${cacheResult.reason}. Re-fetching full leaderboard...`);
    }

    // ------------------------------------------------------------------
    // 2. Fetch complete leaderboard from LeetCode API (all pages)
    // ------------------------------------------------------------------
    try {
      const result = await this._fetchFullLeaderboard(slug);

      if (result.participants.length > 0) {
        // Guard: only update cache if the fetch is sufficiently complete.
        // Partial fetches (due to page failures) must not poison the cache.
        const completeness = result.totalExpected > 0
          ? result.participants.length / result.totalExpected
          : 1;

        if (completeness >= MIN_CACHE_COMPLETENESS) {
          await this._updateCache(slug, result.participants);
        } else {
          console.warn(`[LeetCodeAdapter] Skipping cache update for "${slug}": fetch is incomplete (${result.participants.length}/${result.totalExpected} = ${(completeness * 100).toFixed(1)}%, threshold: ${(MIN_CACHE_COMPLETENESS * 100).toFixed(1)}%).`);
        }

        const elapsed = Date.now() - startTime;
        console.log(`[LeetCodeAdapter] [DIAGNOSTICS] Contest: "${slug}" | Cache: MISS | Expected: ${result.totalExpected} | Fetched: ${result.participants.length} | Completeness: ${(completeness * 100).toFixed(1)}% | Cached: ${completeness >= MIN_CACHE_COMPLETENESS ? 'YES' : 'NO'} | Pages: ${result.pagesFetched} | Time: ${elapsed}ms`);
        return result.participants;
      }
    } catch (err) {
      console.warn(`[LeetCodeAdapter] Failed to fetch full leaderboard for "${slug}":`, err.message);
    }

    // ------------------------------------------------------------------
    // 3. Fallback to standingsProvider
    // ------------------------------------------------------------------
    const standingsProvider = require('../../utils/standingsProvider');
    const ehList = await standingsProvider.fetchStandings('LeetCode', slug);

    const elapsed = Date.now() - startTime;
    console.log(`[LeetCodeAdapter] [DIAGNOSTICS] Contest: "${slug}" | Source: standingsProvider fallback | Participants: ${ehList.length} | Time: ${elapsed}ms`);

    return ehList;
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
    // Fetch page 1 to get total participant count
    const page1Data = await leetcodeUtils.getContestRankingPage(slug, 1);
    if (!page1Data || !page1Data.total_rank || page1Data.total_rank.length === 0) {
      throw new Error(`Contest "${slug}" leaderboard is empty or inaccessible.`);
    }

    const totalUsers = page1Data.user_num || 0;
    const pageSize = page1Data.total_rank.length || DEFAULT_PAGE_SIZE;
    const totalPages = Math.ceil(totalUsers / pageSize);

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

    // Set page ceiling to prevent scraping thousands of pages
    const maxPagesCeiling = parseInt(process.env.LEETCODE_MAX_PAGES_LIMIT, 10) || 50;
    const pagesToFetchLimit = Math.min(totalPages, maxPagesCeiling);

    console.log(`[LeetCodeAdapter] Contest "${slug}": ${totalUsers} participants across ${totalPages} pages. Fetching up to ${pagesToFetchLimit} pages (Ceiling: ${maxPagesCeiling})...`);

    // Fetch remaining pages in controlled concurrent batches
    const remainingPages = [];
    for (let p = 2; p <= pagesToFetchLimit; p++) {
      remainingPages.push(p);
    }

    const fetchedPagesData = new Map();
    const pageErrors = new Map();
    let nextPageIndex = 0;

    const runWorker = async () => {
      while (nextPageIndex < remainingPages.length) {
        // Early check: if we found all students, stop fetching!
        if (activeHandles.size > 0 && matchedHandles.size >= activeHandles.size) {
          break;
        }

        const currentPage = remainingPages[nextPageIndex++];
        if (!currentPage) continue;

        if (PAGE_FETCH_DELAY_MS > 0) {
          await new Promise(resolve => setTimeout(resolve, PAGE_FETCH_DELAY_MS));
        }

        console.log(`[INFO] Fetching page ${currentPage}`);
        try {
          const data = await leetcodeUtils.getContestRankingPage(slug, currentPage);
          fetchedPagesData.set(currentPage, data);

          // Update matched handles from the newly fetched page
          if (data && data.total_rank) {
            for (const entry of data.total_rank) {
              const rawUsername = entry.user_slug || entry.username || '';
              const normUsername = normalizeUsername(rawUsername);
              if (activeHandles.has(normUsername)) {
                matchedHandles.add(normUsername);
              }
            }
          }
        } catch (err) {
          pageErrors.set(currentPage, err);
          const isCf = err.name === 'CloudflareBlockedError' || err.isCloudflare;
          if (isCf) {
            console.warn(`[WARN] Cloudflare blocked page ${currentPage}`);
          } else {
            console.error(`[ERROR] Page ${currentPage} failed to fetch: ${err.message}`);
          }
        }
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(PAGE_CONCURRENCY, remainingPages.length); i++) {
      workers.push(runWorker());
    }
    await Promise.all(workers);

    // Retry Failed Pages Only (Max 2 Passes)
    let failedPages = Array.from(pageErrors.keys());
    let retryPass = 1;
    const maxRetryPasses = 2;

    while (failedPages.length > 0 && retryPass <= maxRetryPasses) {
      // Early check before starting retry pass
      if (activeHandles.size > 0 && matchedHandles.size >= activeHandles.size) {
        break;
      }

      console.warn(`[WARN] Starting retry pass ${retryPass} for ${failedPages.length} failed pages...`);
      await new Promise(resolve => setTimeout(resolve, 2000 * retryPass));

      let nextFailedIndex = 0;
      const runRetryWorker = async () => {
        while (nextFailedIndex < failedPages.length) {
          if (activeHandles.size > 0 && matchedHandles.size >= activeHandles.size) {
            break;
          }

          const currentPage = failedPages[nextFailedIndex++];
          if (!currentPage) continue;

          if (PAGE_FETCH_DELAY_MS > 0) {
            await new Promise(resolve => setTimeout(resolve, PAGE_FETCH_DELAY_MS));
          }

          console.warn(`[WARN] Retrying page ${currentPage} (Attempt ${retryPass + 1})`);
          try {
            const data = await leetcodeUtils.getContestRankingPage(slug, currentPage);
            fetchedPagesData.set(currentPage, data);
            pageErrors.delete(currentPage);

            // Update matched handles from the retried page
            if (data && data.total_rank) {
              for (const entry of data.total_rank) {
                const rawUsername = entry.user_slug || entry.username || '';
                const normUsername = normalizeUsername(rawUsername);
                if (activeHandles.has(normUsername)) {
                  matchedHandles.add(normUsername);
                }
              }
            }
          } catch (err) {
            pageErrors.set(currentPage, err);
            const isCf = err.name === 'CloudflareBlockedError' || err.isCloudflare;
            if (isCf) {
              console.warn(`[WARN] Cloudflare blocked page ${currentPage} again`);
            } else {
              console.error(`[ERROR] Page ${currentPage} failed retry: ${err.message}`);
            }
          }
        }
      };

      const retryWorkers = [];
      for (let i = 0; i < Math.min(PAGE_CONCURRENCY, failedPages.length); i++) {
        retryWorkers.push(runRetryWorker());
      }
      await Promise.all(retryWorkers);

      failedPages = Array.from(pageErrors.keys());
      retryPass++;
    }

    // Process all successfully fetched pages
    let consecutiveEmptyPages = 0;
    for (let p = 2; p <= pagesToFetchLimit; p++) {
      if (!fetchedPagesData.has(p)) {
        console.error(`[ERROR] Page ${p} permanently failed`);
        continue;
      }

      const pageData = fetchedPagesData.get(p);
      if (pageData && pageData.total_rank && pageData.total_rank.length > 0) {
        this._mergePageIntoMap(participantMap, pageData.total_rank, pageData.submissions || [], activeHandles, matchedHandles);
        consecutiveEmptyPages = 0;
      } else {
        consecutiveEmptyPages++;
      }

      if (consecutiveEmptyPages >= 3) {
        console.log(`[LeetCodeAdapter] Stopping pagination after 3 consecutive empty pages at page ${p}.`);
        break;
      }
    }

    const participants = Array.from(participantMap.values());
    console.log(`[LeetCodeAdapter] Fetched ${participants.length} unique participants (deduped) from ${pagesToFetchLimit} pages for "${slug}". Expected: ${totalUsers}.`);

    return {
      participants,
      pagesFetched: pagesToFetchLimit,
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
   * @private
   */
  async _updateCache(slug, participants) {
    if (participants.length === 0) return;

    const pool = db.getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Clear old cache for this contest
      await connection.query("DELETE FROM ContestParticipants WHERE contest_slug = ?", [slug]);

      // Batch insert in chunks of 500
      // Plain INSERT is safe here: DELETE above removed all rows for this
      // contest_slug within the same transaction, so no duplicates can exist.
      const BATCH_SIZE = 500;
      for (let i = 0; i < participants.length; i += BATCH_SIZE) {
        const batch = participants.slice(i, i + BATCH_SIZE);
        // ContestParticipants schema: rank INT NOT NULL, score DECIMAL(10,2) NOT NULL,
        // finish_time INT NOT NULL — NULL is not permitted. Use 0 as the sentinel
        // for unknown/missing values in the cache table.
        const values = batch.map(p => [
          slug,
          p.username,
          p.rank ?? 0,
          Number.isFinite(p.score) ? p.score : 0.00,
          p.problemsSolved ?? 0,
          Number.isFinite(p.finishTime) ? p.finishTime : 0,
          null,  // avatar
          null,  // country
          0      // page_number (not tracked in this path)
        ]);

        await connection.query(
          `INSERT INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, avatar, country, page_number)
           VALUES ?`,
          [values]
        );
      }

      await connection.commit();
      console.log(`[LeetCodeAdapter] Cache updated atomically for "${slug}": ${participants.length} participants.`);
    } catch (err) {
      await connection.rollback();
      console.error(`[LeetCodeAdapter] Failed to update cache for "${slug}":`, err.message);
      // Non-fatal: the participants are still returned from memory
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
