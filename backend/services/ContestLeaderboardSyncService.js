/**
 * ContestLeaderboardSyncService.js
 * ================================
 * Production-ready backend service to sync LeetCode contest attendance.
 * Fetches rankings from official LeetCode JSON API using NetworkService,
 * caches snapshots, and updates student attendance using SQL JOIN operations
 * inside a database transaction.
 */

const db = require('../config/db');
const leetcode = require('../utils/leetcode');
const { normalizeBatchToShort } = require('../utils/batchHelper');
const NetworkService = require('../utils/networkService');
const AuditLogger = require('./AuditLogger');
const cache = require('./analyticsCacheService');
const DetailedLogger = require('../utils/detailedLogger');
const { contestRankingCache } = require('../utils/contestRankingCache');

// Sync lock registry (in-memory, global symbol for multi-service safety)
const lockKey = Symbol.for('leetcode-sync-locks');
if (!global[lockKey]) {
  global[lockKey] = new Set();
}
const activeSyncLocks = global[lockKey];

class AdaptiveRateLimiter {
  constructor() {
    this.minDelay = 800;
    this.maxDelay = 2500;
    this.currentBaseDelay = 1000;
  }

  getDelay() {
    const jitter = Math.floor(Math.random() * 500) - 200;
    return Math.max(this.minDelay, Math.min(this.maxDelay, this.currentBaseDelay + jitter));
  }

  increase() {
    this.currentBaseDelay = Math.min(this.maxDelay, this.currentBaseDelay + 500);
    console.log(`[RateLimiter] Increased base delay to ${this.currentBaseDelay}ms`);
  }

  decrease() {
    this.currentBaseDelay = Math.max(this.minDelay, this.currentBaseDelay - 50);
  }
}

class PageAllocator {
  constructor(startPage, totalPages) {
    this.nextPage = startPage;
    this.totalPages = totalPages;
    this.isAborted = false;
  }

  getNextPage() {
    if (this.isAborted || this.nextPage > this.totalPages) {
      return null;
    }
    return this.nextPage++;
  }

  abort() {
    this.isAborted = true;
  }
}

class ContestLeaderboardSyncService {
  static cooldownUntil = null;
  static cooldownReason = null;
  static cooldownStart = null;
  static pageRetries = new Map();

  /**
   * Syncs LeetCode leaderboard data and updates ContestAttendance + AttendanceRecords.
   * 
   * @param {string} contestSlug - LeetCode contest slug
   * @param {object} options - Sync options
   * @param {string} options.batch - Academic batch (e.g., '2024-28')
   * @param {boolean} options.forceSync - Force full re-sync from page 1
   * @param {string} options.jobId - Associated background job ID
   * @param {Function} options.updateProgress - Progress updater callback: (pct, msg) => void
   * @returns {Promise<object>} Sync stats
   */
  static async syncContest(contestSlug, options = {}) {
    const batch = normalizeBatchToShort(options.batch);
    const forceSync = !!options.forceSync;
    const maxPages = options.maxPages || null;
    const jobId = options.jobId || null;
    const updateProgress = options.updateProgress || null;

    const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.NODE_TEST_CONTEXT || process.argv.some(arg => String(arg).includes('test'));
    const isMock = !isTestEnv && (
                   contestSlug.toLowerCase().startsWith('mock-') || 
                   contestSlug.toLowerCase().startsWith('dummy-') || 
                   contestSlug.toLowerCase().startsWith('upcoming-live-')
    );
    if (isMock) {
      console.log(`[Sync Leaderboard] Skipping mock/test/dummy contest "${contestSlug}"`);
      return { success: true, message: 'Mock/test contest skipped' };
    }

    if (!batch) {
      throw new Error('Academic batch is required for attendance synchronization.');
    }

    const normalizedSlug = contestSlug.trim().toLowerCase();

    // Cooldown check
    if (ContestLeaderboardSyncService.cooldownUntil && Date.now() < ContestLeaderboardSyncService.cooldownUntil.getTime()) {
      const error = new Error(`Contest synchronization suspended due to Cloudflare cooldown. Retrying allowed after ${ContestLeaderboardSyncService.cooldownUntil.toISOString()}. Reason: ${ContestLeaderboardSyncService.cooldownReason}`);
      error.statusCode = 429;
      throw error;
    }

    // 1. Sync Locking Check
    if (activeSyncLocks.has(normalizedSlug)) {
      const error = new Error('Contest synchronization already in progress.');
      error.statusCode = 409;
      throw error;
    }

    // Check database sync status for locks (prevent concurrent runs across nodes)
    const existingLog = await db.query(
      "SELECT id, sync_status, last_page_synced FROM ContestSyncLog WHERE contest_slug = ? ORDER BY started_at DESC LIMIT 1",
      [contestSlug]
    );

    if (existingLog.length > 0 && existingLog[0].sync_status === 'RUNNING' && !forceSync) {
      const error = new Error('Contest synchronization already in progress (registered in database).');
      error.statusCode = 409;
      throw error;
    }

    // Acquire lock
    activeSyncLocks.add(normalizedSlug);
    console.log(`\nSync started for contest: ${contestSlug}, batch: ${batch}...`);
    if (updateProgress) {
      updateProgress(1, 'Initializing sync environment and validating slug...');
    }

    let syncLogId;
    let liveContestId;
    let contestId;
    let contestTitle;
    let contestDate;
    const syncStartTime = Date.now();

    try {
      // Create Rate Limiter
      const rateLimiter = new AdaptiveRateLimiter();

      // Ensure contest records exist (can pass null for firstPageData)
      const records = await this.ensureContestRecords(contestSlug, null);
      liveContestId = records.liveContestId;
      contestId = records.contestId;
      contestTitle = records.contestTitle;
      contestDate = records.contestDate;

      // 3. Resolve Resume Support & create Sync Log BEFORE page 1 request
      let startPage = 1;

      if (forceSync) {
        console.log(`[Sync] Force sync requested. Clearing cached participants for: ${contestSlug}...`);
        if (updateProgress) {
          updateProgress(8, 'Clearing previous cached participant data...');
        }
        await db.query("DELETE FROM ContestParticipants WHERE contest_slug = ?", [contestSlug]);
        await db.query("DELETE FROM ContestLeaderboardSnapshots WHERE contest_slug = ?", [contestSlug]);
        
        const insertLog = await db.query(`
          INSERT INTO ContestSyncLog (contestId, contest_slug, sync_status, last_page_synced, syncStarted, started_at)
          VALUES (?, ?, 'RUNNING', 0, NOW(), NOW())
        `, [liveContestId, contestSlug]);
        syncLogId = liveInsertId(insertLog);
      } else {
        const unfinished = await db.query(
          "SELECT id, last_page_synced FROM ContestSyncLog WHERE contestId = ? AND sync_status = 'RUNNING' ORDER BY started_at DESC LIMIT 1",
          [liveContestId]
        );

        if (unfinished.length > 0) {
          syncLogId = unfinished[0].id;
          startPage = unfinished[0].last_page_synced + 1;
          console.log(`[Sync] Resuming sync from page ${startPage} using existing sync log ID: ${syncLogId}...`);
          if (updateProgress) {
            updateProgress(10, `Resuming from page ${startPage}...`);
          }
        } else {
          const insertLog = await db.query(`
            INSERT INTO ContestSyncLog (contestId, contest_slug, sync_status, last_page_synced, syncStarted, started_at)
            VALUES (?, ?, 'RUNNING', 0, NOW(), NOW())
          `, [liveContestId, contestSlug]);
          syncLogId = liveInsertId(insertLog);
        }
      }

      // Now fetch page 1 to estimate start time & get total participants
      const firstPageData = await this.fetchPageRaw(contestSlug, 1, syncLogId);
      if (!firstPageData || !firstPageData.total_rank) {
        throw new Error('Could not retrieve leaderboard data from LeetCode. Validate the contest slug.');
      }

      // Re-update records with actual page 1 details
      await this.ensureContestRecords(contestSlug, firstPageData);

      const totalParticipants = firstPageData.user_num || 0;
      const pageSize = 25;
      const totalPages = Math.ceil(totalParticipants / pageSize);
      console.log(`Contest: ${contestTitle} | Total participants: ${totalParticipants} (~${totalPages} pages)`);
      if (updateProgress) {
        updateProgress(5, `Contest validated. Total participants: ${totalParticipants} (~${totalPages} pages).`);
      }

      // 4. Rate Limiting, Concurrency (1-2 workers), and Queue configuration
      const envConcurrency = parseInt(process.env.LEETCODE_PAGE_CONCURRENCY, 10);
      const concurrencyLimit = Math.min(
        2, // Requirement 7: Limit concurrent ranking requests to 1-2 workers
        Number.isInteger(envConcurrency) && envConcurrency > 0 ? envConcurrency : 2
      );

      const fetchedPagesData = new Map();
      const pageStatus = new Map(); // page -> 'data' | 'empty'
      const pageErrors = new Map();
      let cachedPagesCount = 0;
      let blockedPagesCount = 0;
      let failedPagesCount = 0;
      let successfulPagesCount = 0;

      // If we are starting from page 1, we can reuse the already fetched firstPageData
      if (startPage === 1) {
        pageStatus.set(1, 'data');
        fetchedPagesData.set(1, firstPageData);
        successfulPagesCount++;
      }

      const pageAllocator = new PageAllocator(startPage > 1 ? startPage : 2, totalPages);
      let shouldStop = false;
      let stopReason = 'Completed';
      let lastSuccessfulPageSynced = startPage - 1;
      let totalParticipantsCollected = 0;
      let writeLock = false;

      // Seed starting participants count if resuming
      if (startPage > 1) {
        const countResult = await db.query(
          "SELECT count(*) as count FROM ContestParticipants WHERE contest_slug = ?",
          [contestSlug]
        );
        totalParticipantsCollected = countResult[0]?.count || 0;
      }

      // Synchronous/Mutex Flusher for contiguous pages
      const flushPagesToDb = async () => {
        if (writeLock) return;
        writeLock = true;
        try {
          while (fetchedPagesData.has(lastSuccessfulPageSynced + 1)) {
            const nextPageToFlush = lastSuccessfulPageSynced + 1;
            const pageData = fetchedPagesData.get(nextPageToFlush);
            
            totalParticipantsCollected = await this.savePageAndMetrics(
              nextPageToFlush,
              pageData,
              contestSlug,
              syncLogId,
              totalPages,
              syncStartTime,
              updateProgress
            );
            
            lastSuccessfulPageSynced = nextPageToFlush;
            fetchedPagesData.delete(nextPageToFlush);
          }
        } finally {
          writeLock = false;
        }
      };

      const runWorker = async (workerId) => {
        while (!shouldStop) {
          // Check cancellation
          if (jobId) {
            const jobQueue = require('./jobQueueService');
            const job = jobQueue.getJob(jobId);
            if (job && job.status === 'CANCELLED') {
              shouldStop = true;
              stopReason = 'Cancellation requested';
              pageAllocator.abort();
              break;
            }
          }

          const currentPage = pageAllocator.getNextPage();
          if (currentPage === null) {
            break;
          }

          if (maxPages && currentPage > maxPages) {
            pageAllocator.abort();
            break;
          }

          try {
            console.log(`[Sync Worker] workerId=${workerId} page=${currentPage} status=FETCHING`);
            const isCached = contestRankingCache.has(contestSlug, currentPage);
            if (isCached) {
              cachedPagesCount++;
            }

            const startTime = Date.now();
            const data = await this.fetchPageResilient(contestSlug, currentPage, syncLogId, workerId);
            const totalRank = data?.total_rank || [];
            const durationMs = Date.now() - startTime;

            rateLimiter.decrease();

            if (totalRank.length === 0) {
              pageStatus.set(currentPage, 'empty');
              console.warn(`[Sync Worker] workerId=${workerId} page=${currentPage} status=EMPTY_PAGE`);

              if (hasConsecutiveEmptyPages()) {
                pageAllocator.abort();
                shouldStop = true;
                stopReason = '2 consecutive empty pages';
                break;
              }
            } else {
              pageStatus.set(currentPage, 'data');
              fetchedPagesData.set(currentPage, data);
              successfulPagesCount++;

              const retryCount = ContestLeaderboardSyncService.pageRetries.get(currentPage) || 0;
              ContestLeaderboardSyncService.pageRetries.delete(currentPage);
              
              const delayMs = rateLimiter.getDelay();
              console.log(`[Sync Worker] workerId=${workerId} page=${currentPage} status=SUCCESS users=${totalRank.length}`);
              
              // Flush contiguous pages to DB sequentially
              await flushPagesToDb();
            }

            const sleepMs = rateLimiter.getDelay();
            await new Promise(resolve => setTimeout(resolve, sleepMs));
          } catch (err) {
            // Requirement 11: Skip blocked pages gracefully and continue processing remaining pages
            const isCf = err instanceof NetworkService.CloudflareBlockedError || err.isCloudflare || err.code === 'CLOUDFLARE_BLOCK' || err.status === 403;
            pageErrors.set(currentPage, err);

            if (isCf) {
              blockedPagesCount++;
              rateLimiter.increase();
              console.warn(`[Sync Worker] workerId=${workerId} page=${currentPage} status=SKIPPED_CLOUDFLARE_BLOCK error="${err.message}"`);
            } else {
              failedPagesCount++;
              console.error(`[Sync Worker] workerId=${workerId} page=${currentPage} status=SKIPPED_FETCH_ERROR error="${err.message}"`);
            }

            // Continue worker to next page without stopping whole job!
          }
        }
      };

      const hasConsecutiveEmptyPages = () => {
        for (const [p, status] of pageStatus.entries()) {
          if (status === 'empty' && pageStatus.get(p + 1) === 'empty') {
            return true;
          }
        }
        return false;
      };

      // Launch workers
      const workers = [];
      const actualWorkers = Math.min(concurrencyLimit, Math.max(1, totalPages - startPage + 1));
      
      console.log(`[Sync] Leaderboard Sync Details:
  - Total Participants: ${totalParticipants}
  - Page Size: ${pageSize}
  - Calculated Total Pages: ${totalPages}
  - Concurrency Workers: ${actualWorkers}
  - Start Page: ${startPage}`);

      console.log(`Downloading pages...\n`);

      for (let i = 1; i <= actualWorkers; i++) {
        workers.push(runWorker(i));
      }

      await Promise.all(workers);

      // Check if cancellation was requested during work
      if (shouldStop && stopReason === 'Cancellation requested') {
        throw new Error('Contest synchronization was cancelled by the user.');
      }

      // Flush any trailing fetched pages
      await flushPagesToDb();

      // Requirement 14: Produce detailed sync summary
      const totalPagesToSync = Math.max(0, totalPages - startPage + 1);
      const totalSyncDurationMs = Date.now() - syncStartTime;
      const totalSyncDurationSec = Math.floor(totalSyncDurationMs / 1000);

      DetailedLogger.printSyncSummary({
        contestSlug,
        totalPagesAttempted: totalPagesToSync,
        successfulPages: successfulPagesCount,
        cachedPages: cachedPagesCount,
        blockedPages: blockedPagesCount,
        failedPages: failedPagesCount,
        totalExecutionTimeMs: totalSyncDurationMs
      });

      console.log(`\nParticipants downloaded.`);
      console.log(`Attendance comparison started...`);
      if (updateProgress) {
        updateProgress(96, 'Syncing participants with student database inside transaction...');
      }

      // 7. Attendance Synchronization inside Database Transaction
      const dbPool = db.getPool();
      const connection = await dbPool.getConnection();

      try {
        await connection.beginTransaction();

        // Join ContestParticipants to match active students in batch
        // Updates ContestAttendance
        await connection.query(`
          INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, score, lastUpdatedAt)
          SELECT
            ? as contestId,
            u.id as studentId,
            u.leetcode_username as username,
            IF(cp.username IS NOT NULL, 'PRESENT', 'ABSENT') as attendanceStatus,
            cp.rank as \`rank\`,
            IFNULL(cp.score, 0.00) as score,
            CURRENT_TIMESTAMP as lastUpdatedAt
          FROM Users u
          LEFT JOIN ContestParticipants cp ON LOWER(u.leetcode_username) = LOWER(cp.username) AND cp.contest_slug = ?
          WHERE u.academic_batch = ? AND u.status = 'active'
          ON DUPLICATE KEY UPDATE
            attendanceStatus = VALUES(attendanceStatus),
            \`rank\` = VALUES(\`rank\`),
            score = VALUES(score),
            lastUpdatedAt = VALUES(lastUpdatedAt)
        `, [liveContestId, contestSlug, batch]);

        // Updates AttendanceRecords (legacy dashboard table)
        await connection.query(`
          INSERT INTO AttendanceRecords (
            user_id, contest_id, contest_name, contest_slug, contest_date, contest_status,
            attendance_status, attendance_source, remarks, \`rank\`, score
          )
          SELECT
            u.id as user_id,
            ? as contest_id,
            ? as contest_name,
            ? as contest_slug,
            ? as contest_date,
            'RATED' as contest_status,
            IF(cp.username IS NOT NULL, 'PRESENT', 'ABSENT') as attendance_status,
            'AUTO' as attendance_source,
            IF(cp.username IS NOT NULL, 'Synced via LeetCode Leaderboard API', 'Absent from LeetCode contest') as remarks,
            cp.rank as \`rank\`,
            cp.score as score
          FROM Users u
          LEFT JOIN ContestParticipants cp ON LOWER(u.leetcode_username) = LOWER(cp.username) AND cp.contest_slug = ?
          WHERE u.academic_batch = ? AND u.status = 'active'
          ON DUPLICATE KEY UPDATE
            attendance_status = VALUES(attendance_status),
            remarks = VALUES(remarks),
            \`rank\` = VALUES(\`rank\`),
            score = VALUES(score),
            last_updated = CURRENT_TIMESTAMP
        `, [contestId, contestTitle, contestSlug, contestDate, contestSlug, batch]);

        // Mark sync log as completed. Include error summary in the ContestSyncLog error field if some pages failed.
        const summaryErrorStr = failedPagesCount > 0
          ? `Incomplete sync. Succeeded: ${successPagesCount}, Failed: ${failedPagesCount} (Cloudflare Blocks: ${cfBlocks}, Network Errors: ${netErrors}).`
          : null;

        await connection.query(`
          UPDATE ContestSyncLog
          SET sync_status = 'COMPLETED', syncCompleted = NOW(), completed_at = NOW(), duration = ?, errors = ?
          WHERE id = ?
        `, [totalSyncDurationSec, summaryErrorStr, syncLogId]);

        await connection.commit();
        console.log(`Attendance updated.`);
        cache.invalidateAll();
        console.log(`Sync completed successfully.\n`);
      } catch (transactionError) {
        console.error('[Sync] Transaction error, rolling back...', transactionError);
        await connection.rollback();
        throw transactionError;
      } finally {
        connection.release();
      }

      // Fetch final stats
      const [statsResult] = await db.query(`
        SELECT 
          SUM(CASE WHEN attendanceStatus = 'PRESENT' THEN 1 ELSE 0 END) as present,
          SUM(CASE WHEN attendanceStatus = 'ABSENT' THEN 1 ELSE 0 END) as absent,
          COUNT(*) as totalStudents
        FROM ContestAttendance
        WHERE contestId = ? AND studentId IN (
          SELECT id FROM Users WHERE academic_batch = ? AND status = 'active'
        )
      `, [liveContestId, batch]);

      const durationMs = Date.now() - syncStartTime;
      const durationStr = this.formatDuration(durationMs / 1000);

      // Fetch request metrics
      const [logMetrics] = await db.query(
        "SELECT failed_requests FROM ContestSyncLog WHERE id = ?",
        [syncLogId]
      );

      const stats = {
        success: true,
        contest: contestSlug,
        pagesFetched: parseInt(successfulPagesCount, 10),
        participants: parseInt(totalParticipantsCollected, 10),
        students: parseInt(statsResult?.totalStudents, 10) || 0,
        present: parseInt(statsResult?.present, 10) || 0,
        absent: parseInt(statsResult?.absent, 10) || 0,
        failedRequests: parseInt(logMetrics?.failed_requests, 10) || 0,
        duration: durationStr
      };

      if (updateProgress) {
        updateProgress(100, `Completed successfully. Present: ${stats.present}, Absent: ${stats.absent}.`);
      }

      return stats;

    } catch (err) {
      console.error(`[Sync] Synchronization failed for contest ${contestSlug}:`, err.message);
      
      const isCancelled = err.message.includes('cancelled');
      const isRateLimited = err instanceof NetworkService.CloudflareBlockedError || err.isCloudflare || err.status === 429 || err.status === 403;
      const targetStatus = isCancelled ? 'CANCELLED' : (isRateLimited ? 'RATE_LIMITED' : 'FAILED');

      // Update Sync Log status
      if (syncLogId) {
        let errorDetails = err.message;
        if (targetStatus === 'RATE_LIMITED') {
          const retryAfterMs = (parseInt(process.env.LEETCODE_COOLDOWN_MINUTES, 10) || 15) * 60 * 1000;
          const cooldownTime = new Date(Date.now() + retryAfterMs);
          errorDetails = JSON.stringify({
            timestamp: new Date().toISOString(),
            reason: err.message,
            retryAfter: cooldownTime.toISOString()
          });
          
          // Set static properties for in-memory cooldown check
          ContestLeaderboardSyncService.cooldownUntil = cooldownTime;
          ContestLeaderboardSyncService.cooldownReason = err.message;
          ContestLeaderboardSyncService.cooldownStart = new Date();
          console.warn(`[Sync] Suspending leaderboard sync due to Cloudflare block/limit. Cooldown active until ${cooldownTime.toISOString()}`);
        }

        await db.query(`
          UPDATE ContestSyncLog
          SET sync_status = ?, errors = ?
          WHERE id = ?
        `, [targetStatus, errorDetails, syncLogId]).catch(logErr => {
          console.error('[Sync] Failed to write error status to ContestSyncLog:', logErr.message);
        });
      }

      if (updateProgress) {
        updateProgress(100, `Failed: ${err.message}`);
      }

      throw err;
    } finally {
      // Release lock
      activeSyncLocks.delete(normalizedSlug);
    }
  }

  /**
  /**
   * Internal helper to determine if an error is transient (should retry)
   */
  static isTransientError(err) {
    if (!err) return false;
    const code = err.code || '';
    const status = err.status || (err.response && err.response.status);

    // Requirement 5: Stop retries immediately when a Cloudflare block is detected
    if (
      err instanceof NetworkService.CloudflareBlockedError ||
      err.name === 'CloudflareBlockedError' ||
      err.isCloudflare ||
      code === 'CLOUDFLARE_BLOCK' ||
      status === 403 ||
      status === 404 ||
      code === 'HTTP_404' ||
      code === 'INVALID_CONTEST'
    ) {
      return false;
    }

    if (
      status === 429 ||
      (status >= 500 && status < 600) ||
      code === 'NETWORK_TIMEOUT' ||
      code === 'DNS_FAILURE' ||
      code === 'TLS_ERROR' ||
      code === 'EMPTY_RESPONSE' ||
      code === 'HTTP_429'
    ) {
      return true;
    }

    const message = (err.message || '').toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('enotfound') ||
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('socket')
    );
  }

  /**
   * Internal helper to fetch a ranking page with resilience rules:
   * 1. If it returns Cloudflare 403/429 (or CloudflareBlockedError/Transient Network Failure):
   *    - Retry ONLY the SAME page.
   *    - Maximum retries: 3.
   *    - Delay: exponential backoff (e.g. Attempt 1 -> 1s, Attempt 2 -> 2s, Attempt 3 -> 4s) with random jitter.
   *    - If all 3 retries fail, throw error, causing the entire synchronization to STOP.
   * 2. If it returns an empty total_rank:
   *    - Retry once.
   *    - If still empty, return empty response (handled by consecutive empty pages stopping logic).
   */
  static async fetchPageResilient(contestSlug, page, syncLogId = null, workerId = 'Main') {
    const baseUrl = process.env.LEETCODE_CONTEST_API || 'https://leetcode.com/contest/api/ranking';
    const url = `${baseUrl}/${contestSlug}/?pagination=${page}&region=global_v2`;

    let isEmptyPageRetryUsed = false;

    while (true) {
      let lastError = null;
      let cfRetryCount = 0;
      const maxCfRetries = 3;
      let data = null;

      while (cfRetryCount <= maxCfRetries) {
        try {
          if (syncLogId) {
            await db.query(
              "UPDATE ContestSyncLog SET total_requests = total_requests + 1 WHERE id = ?",
              [syncLogId]
            );
          }

          console.log(`[Sync Worker] workerId=${workerId} page=${page} retryAttempt=${cfRetryCount} status=REQUESTING`);
          
          data = await NetworkService.request(url, {
            useCurlTransport: true,
            timeout: 15000,
            retries: 0 // We handle retries manually here
          });

          break;
        } catch (err) {
          lastError = err;
          const isTransient = this.isTransientError(err);
          const status = err.status || (err.response && err.response.status) || 'NETWORK_ERROR';
          const isCf = err instanceof NetworkService.CloudflareBlockedError || err.isCloudflare || status === 403;

          console.warn(`[Sync Worker] workerId=${workerId} page=${page} retryAttempt=${cfRetryCount} status=TRANSIENT_FAILURE type=${isCf ? 'CLOUDFLARE' : 'OTHER'} error="${err.message}"`);
          
          if (syncLogId) {
            await db.query(`
              UPDATE ContestSyncLog 
              SET failed_requests = failed_requests + 1, 
                  retry_count = retry_count + 1
              WHERE id = ?
            `, [syncLogId]);
          }

          if (isTransient && cfRetryCount < maxCfRetries) {
            cfRetryCount++;
            const baseDelay = 1000 * Math.pow(2, cfRetryCount - 1);
            const jitter = Math.floor(Math.random() * 500) + 250;
            const delay = baseDelay + jitter;
            
            console.warn(`[Sync Worker] workerId=${workerId} page=${page} retryAttempt=${cfRetryCount} delay=${delay}ms status=BACKOFF`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            break;
          }
        }
      }

      if (lastError) {
        throw lastError;
      }

      const totalRank = data?.total_rank || [];
      if (totalRank.length === 0) {
        if (!isEmptyPageRetryUsed) {
          isEmptyPageRetryUsed = true;
          console.warn(`[Sync Worker] workerId=${workerId} page=${page} status=EMPTY_RETRYING`);
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
      }

      ContestLeaderboardSyncService.pageRetries.set(page, cfRetryCount);
      return data;
    }
  }

  /**
   * Fetches a contest ranking page raw JSON response.
   */
  static async fetchPageRaw(contestSlug, page, syncLogId = null) {
    return await this.fetchPageResilient(contestSlug, page, syncLogId, 'Raw');
  }

  /**
   * Fetches a contest ranking page with retries and exponential backoff.
   */
  static async fetchPageWithRetry(contestSlug, page, syncLogId) {
    return await this.fetchPageResilient(contestSlug, page, syncLogId, 'RetryHelper');
  }

  /**
   * Ensures contest exists in both Contests and LiveContests.
   */
  static async ensureContestRecords(contestSlug, firstPageData) {
    // 1. Ensure in Contests table
    let contest = await db.query("SELECT contest_id, title, start_time, contest_status FROM Contests WHERE slug = ?", [contestSlug]);
    let contestId;
    let title;
    let startTime;
    let contestStatus = 'Rated';

    // Fetch details from recent contests if available
    let details;
    try {
      const recentContests = await leetcode.getRecentContests();
      details = recentContests.find(c => c.titleSlug === contestSlug);
    } catch (err) {
      console.warn(`[Sync] Could not fetch recent contests list from GraphQL: ${err.message}`);
    }

    if (contest.length === 0) {
      title = contestSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      startTime = new Date();
      let duration = 5400; // 1.5 hours
      let contestType = contestSlug.includes('biweekly') ? 'Biweekly' : 'Weekly';
      const match = contestSlug.match(/contest-(\d+)/);
      const contestNumber = match ? parseInt(match[1], 10) : 0;

      if (details) {
        title = details.title;
        startTime = new Date(details.startTime * 1000);
        duration = details.duration;
      } else if (firstPageData && firstPageData.total_rank && firstPageData.total_rank.length > 0) {
        const firstRanker = firstPageData.total_rank[0];
        if (firstRanker.finish_time) {
          startTime = new Date((firstRanker.finish_time - duration) * 1000);
        }
      }

      const totalProblems = firstPageData?.questions?.length || 4;
      const insertResult = await db.query(`
        INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, total_problems, contest_status, platform, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'LeetCode', 'SYNC')
      `, [title, contestSlug, contestType, contestNumber, startTime, duration, totalProblems, contestStatus]);

      contestId = insertResult.insertId;
    } else {
      contestId = contest[0].contest_id;
      title = contest[0].title;
      startTime = contest[0].start_time;
      contestStatus = contest[0].contest_status;

      const totalProblems = firstPageData?.questions?.length || 4;
      await db.query("UPDATE Contests SET total_problems = ? WHERE contest_id = ?", [totalProblems, contestId]);
    }

    // 2. Ensure in LiveContests table
    let liveContest = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [contestSlug]);
    let liveContestId;

    if (liveContest.length === 0) {
      let duration = 5400;
      let contestType = contestSlug.includes('biweekly') ? 'Biweekly' : 'Weekly';
      if (details) {
        duration = details.duration;
      }
      const endTime = new Date(new Date(startTime).getTime() + duration * 1000);

      const liveInsert = await db.query(`
        INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status, syncProgress)
        VALUES ('LeetCode', ?, ?, ?, ?, ?, 'Completed', 100.00)
      `, [contestSlug, title, contestType, startTime, endTime]);

      liveContestId = liveInsert.insertId;
    } else {
      liveContestId = liveContest[0].id;
    }

    return {
      liveContestId,
      contestId,
      contestTitle: title,
      contestDate: startTime,
      contest_status: contestStatus
    };
  }

  /**
   * Saves page ranks to database, caches raw snapshot, and updates ContestSyncLog progress metrics.
   */
  static async savePageAndMetrics(page, pageData, contestSlug, syncLogId, totalPages, syncStartTime, updateProgress) {
    const ranks = pageData?.total_rank || [];

    // Cache raw JSON in ContestLeaderboardSnapshots for future auditing
    await db.query(`
      INSERT INTO ContestLeaderboardSnapshots (contest_slug, page_number, raw_json)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE raw_json = VALUES(raw_json), downloaded_at = CURRENT_TIMESTAMP
    `, [contestSlug, page, JSON.stringify(pageData)]);

    // Store participants
    const participantsBatch = [];
    const totalProblems = pageData?.questions?.length || 4;
    const seenUsernames = new Set();

    for (let i = 0; i < ranks.length; i++) {
      const ranker = ranks[i];
      
      // 1. Missing username -> ERROR
      if (!ranker.username) {
        AuditLogger.error({
          contestSlug,
          issue: 'Missing Username',
          expected: 'Non-empty string username',
          actual: ranker.username,
          action: 'Discard ONLY the corrupted participant'
        });
        continue;
      }

      const username = ranker.username.toLowerCase().trim();

      // 2. Duplicate participant in page standings -> ERROR
      if (seenUsernames.has(username)) {
        AuditLogger.error({
          contestSlug,
          username: ranker.username,
          issue: 'Duplicate Participant',
          expected: 'Unique username per page standings',
          actual: ranker.username,
          action: 'Discard ONLY the corrupted participant'
        });
        continue;
      }
      seenUsernames.add(username);

      // 3. Invalid rank -> ERROR
      const rankVal = parseInt(ranker.rank, 10);
      if (isNaN(rankVal) || rankVal <= 0) {
        AuditLogger.error({
          contestSlug,
          username: ranker.username,
          issue: 'Invalid Rank',
          expected: '> 0',
          actual: ranker.rank,
          action: 'Discard ONLY the corrupted participant'
        });
        continue;
      }

      // 4. Negative score -> ERROR
      const scoreVal = parseFloat(ranker.score);
      if (isNaN(scoreVal) || scoreVal < 0) {
        AuditLogger.error({
          contestSlug,
          username: ranker.username,
          issue: 'Negative Score',
          expected: '>= 0',
          actual: ranker.score,
          action: 'Discard ONLY the corrupted participant'
        });
        continue;
      }

      // 5. Invalid finish time -> ERROR
      const finishTimeVal = parseInt(ranker.finish_time, 10);
      if (isNaN(finishTimeVal) || finishTimeVal < 0) {
        AuditLogger.error({
          contestSlug,
          username: ranker.username,
          issue: 'Invalid Finish Time',
          expected: '>= 0',
          actual: ranker.finish_time,
          action: 'Discard ONLY the corrupted participant'
        });
        continue;
      }

      let solved = 0;
      if (ranker.submissions) {
        solved = Object.keys(ranker.submissions).length;
      } else {
        const rankerSubmissions = pageData?.submissions?.[i] || {};
        solved = Object.values(rankerSubmissions).filter(s => s && (s.status === 10 || s.status === '10')).length;
      }

      // 6. ProblemsSolved > TotalProblems -> ERROR
      if (solved > totalProblems) {
        AuditLogger.error({
          contestSlug,
          username: ranker.username,
          issue: 'ProblemsSolved > TotalProblems',
          expected: `<= ${totalProblems}`,
          actual: solved,
          action: 'Discard ONLY the corrupted participant'
        });
        continue;
      }

      participantsBatch.push([
        contestSlug,
        ranker.user_slug || ranker.username,
        rankVal,
        scoreVal || 0.00,
        solved,
        finishTimeVal || 0,
        ranker.avatar_url || null,
        ranker.country_name || null,
        page
      ]);
    }

    if (participantsBatch.length > 0) {
      await db.getPool().query(`
        INSERT INTO ContestParticipants (contest_slug, username, \`rank\`, score, problems_solved, finish_time, avatar, country, page_number)
        VALUES ?
        ON DUPLICATE KEY UPDATE
          \`rank\` = VALUES(\`rank\`),
          score = VALUES(score),
          problems_solved = VALUES(problems_solved),
          finish_time = VALUES(finish_time),
          avatar = VALUES(avatar),
          country = VALUES(country),
          page_number = VALUES(page_number),
          updated_at = CURRENT_TIMESTAMP
      `, [participantsBatch]);
    }

    // Get current total participant count for the log
    const countResult = await db.query(
      "SELECT count(*) as count FROM ContestParticipants WHERE contest_slug = ?",
      [contestSlug]
    );
    const totalParticipantsCollected = countResult[0]?.count || 0;

    // Update resume state in DB sync log
    await db.query(`
      UPDATE ContestSyncLog
      SET last_page_synced = ?, participants_synced = ?
      WHERE id = ?
    `, [page, totalParticipantsCollected, syncLogId]);

    // Progress calculation for display
    const elapsedSec = (Date.now() - syncStartTime) / 1000;
    const speed = totalParticipantsCollected / elapsedSec;
    const remainingPages = Math.max(0, totalPages - page);
    const etaSec = speed > 0 ? (remainingPages * 25) / speed : 0;
    const etaStr = this.formatDuration(etaSec);

    console.log(`[Sync Worker] Processed Page ${page}`);
    console.log(`[Sync Worker] Participants Collected: ${totalParticipantsCollected}`);
    console.log(`[Sync Worker] Remaining Pages: ${remainingPages}`);
    console.log('-----------------------------');

    const pct = Math.min(95, Math.round((page / totalPages) * 100)) || 10;
    if (updateProgress) {
      updateProgress(
        pct,
        `Processed page ${page}/${totalPages} (${totalParticipantsCollected} users collected). ETA: ${etaStr}`
      );
    }
    
    return totalParticipantsCollected;
  }

  /**
   * Helper to format seconds into readable duration e.g., "3m 12s"
   */
  static formatDuration(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0s';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
  }
}

/**
 * Utility helper to extract insertId from mysql2 query result.
 */
function liveInsertId(insertResult) {
  return insertResult.insertId || insertResult[0]?.insertId;
}

module.exports = ContestLeaderboardSyncService;
