/**
 * contestLeaderboardSyncController.js
 * ===================================
 * Controller layer for LeetCode Leaderboard sync.
 * Enqueues synchronization as background tasks and manages job history.
 */

const ContestLeaderboardSyncService = require('../services/ContestLeaderboardSyncService');
const jobQueue = require('../services/jobQueueService');
const db = require('../config/db');
const { normalizeBatchToShort } = require('../utils/batchHelper');

/**
 * POST /api/contest/sync/:contestSlug
 * Enqueues a LeetCode contest sync job to run in the background.
 */
async function startSync(req, res) {
  const { contestSlug } = req.params;
  const { batch, forceSync } = req.body;

  if (!contestSlug) {
    return res.status(400).json({
      success: false,
      message: 'Contest slug parameter is required.'
    });
  }

  const normalizedBatch = normalizeBatchToShort(batch);
  if (!normalizedBatch) {
    return res.status(400).json({
      success: false,
      message: 'Academic batch is required in request body (e.g., {"batch": "2024-28"}).'
    });
  }

  try {
    // Check if a sync is already running in memory for this contestSlug
    const activeJobs = [
      ...jobQueue.listJobs({ type: jobQueue.JOB_TYPE.LEETCODE_CONTEST_SYNC, status: jobQueue.JOB_STATUS.RUNNING }),
      ...jobQueue.listJobs({ type: jobQueue.JOB_TYPE.CONTEST_ATTENDANCE_SYNC, status: jobQueue.JOB_STATUS.RUNNING })
    ];
    
    const isAlreadyRunning = activeJobs.some(j => j.payload?.contestSlug === contestSlug || j.payload?.contestId === contestSlug);
    if (isAlreadyRunning) {
      return res.status(409).json({
        success: false,
        message: 'Contest synchronization already in progress.'
      });
    }

    // Enqueue the job in background queue
    const ContestAttendanceSyncService = require('../services/ContestAttendanceSyncService');
    const jobId = jobQueue.enqueue(
      jobQueue.JOB_TYPE.CONTEST_ATTENDANCE_SYNC,
      { contestSlug, batch: normalizedBatch, forceSync: !!forceSync },
      async (job, updateProgress) => {
        const [contest] = await db.query("SELECT platform FROM Contests WHERE slug = ?", [contestSlug]);
        const platform = contest ? contest.platform : 'LeetCode';

        if (platform === 'LeetCode') {
          const ContestLeaderboardSyncService = require('../services/ContestLeaderboardSyncService');
          return await ContestLeaderboardSyncService.syncContest(contestSlug, {
            batch: normalizedBatch,
            forceSync: !!forceSync,
            jobId: job.id,
            updateProgress
          });
        } else {
          return await ContestAttendanceSyncService.syncContestAttendance(contestSlug, {
            jobId: job.id,
            updateProgress,
            pass: 4
          });
        }
      }
    );

    return res.status(202).json({
      success: true,
      message: 'Contest synchronization started in background.',
      jobId
    });
  } catch (err) {
    console.error(`[Controller] StartSync error for ${contestSlug}:`, err.message);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to trigger background synchronization.'
    });
  }
}

/**
 * GET /api/contest/sync/status/:jobId
 * Returns the status of a queued or running background sync job.
 */
async function getSyncStatus(req, res) {
  const { jobId } = req.params;
  const job = jobQueue.getJob(jobId);
  
  if (!job) {
    return res.status(404).json({
      success: false,
      message: `Job ${jobId} not found.`
    });
  }

  return res.json({
    success: true,
    jobId: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    message: job.message,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    result: job.result
  });
}

/**
 * POST /api/contest/sync/cancel/:jobId
 * Cancels a pending or active sync job.
 */
async function cancelSync(req, res) {
  const { jobId } = req.params;
  const success = jobQueue.cancelJob(jobId);

  if (!success) {
    return res.status(400).json({
      success: false,
      message: `Job ${jobId} could not be cancelled. It may not exist, or it is already in a final state.`
    });
  }

  return res.json({
    success: true,
    message: `Job ${jobId} cancellation requested successfully.`
  });
}

/**
 * POST /api/contest/sync/retry/:jobId
 * Retries a failed or cancelled background sync job by enqueuing a new one.
 */
async function retrySync(req, res) {
  const { jobId } = req.params;
  const job = jobQueue.getJob(jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      message: `Job ${jobId} not found.`
    });
  }

  if (job.status !== jobQueue.JOB_STATUS.FAILED && job.status !== jobQueue.JOB_STATUS.CANCELLED) {
    return res.status(400).json({
      success: false,
      message: `Job ${jobId} is currently in '${job.status}' status and cannot be retried.`
    });
  }

  const { contestSlug, batch, forceSync } = job.payload;
  try {
    const ContestAttendanceSyncService = require('../services/ContestAttendanceSyncService');
    const newJobId = jobQueue.enqueue(
      jobQueue.JOB_TYPE.CONTEST_ATTENDANCE_SYNC,
      { contestSlug, batch, forceSync: !!forceSync },
      async (j, updateProgress) => {
        const [contest] = await db.query("SELECT platform FROM Contests WHERE slug = ?", [contestSlug]);
        const platform = contest ? contest.platform : 'LeetCode';

        if (platform === 'LeetCode') {
          const ContestLeaderboardSyncService = require('../services/ContestLeaderboardSyncService');
          return await ContestLeaderboardSyncService.syncContest(contestSlug, {
            batch,
            forceSync: !!forceSync,
            jobId: j.id,
            updateProgress
          });
        } else {
          return await ContestAttendanceSyncService.syncContestAttendance(contestSlug, {
            jobId: j.id,
            updateProgress,
            pass: 4
          });
        }
      }
    );

    return res.status(202).json({
      success: true,
      message: `Retry started in background. New Job ID: ${newJobId}`,
      jobId: newJobId
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to retry background synchronization.'
    });
  }
}

/**
 * GET /api/contest/sync/history
 * Returns memory job queues and permanent database ContestSyncLog entries.
 */
async function getSyncHistory(req, res) {
  try {
    // 1. Get recent in-memory jobs from jobQueueService
    const memoryJobs = [
      ...jobQueue.listJobs({ type: jobQueue.JOB_TYPE.LEETCODE_CONTEST_SYNC }),
      ...jobQueue.listJobs({ type: jobQueue.JOB_TYPE.CONTEST_ATTENDANCE_SYNC })
    ];
    const formattedMemory = memoryJobs.map(j => ({
      source: 'memory',
      jobId: j.id,
      status: j.status,
      progress: j.progress,
      message: j.message,
      contestSlug: j.payload?.contestSlug || j.payload?.contestId,
      batch: j.payload?.batch,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      error: j.error
    }));

    // 2. Query persistent sync logs from ContestSyncLog
    const dbLogs = await db.query(`
      SELECT 
        l.id as logId,
        l.contest_slug as contestSlug,
        l.sync_status as status,
        l.last_page_synced as lastPageSynced,
        l.participants_synced as participantsSynced,
        l.total_requests as totalRequests,
        l.failed_requests as failedRequests,
        l.retry_count as retryCount,
        l.started_at as startedAt,
        l.completed_at as completedAt,
        l.errors as error,
        l.duration,
        c.title as contestTitle
      FROM ContestSyncLog l
      LEFT JOIN Contests c ON l.contestId = c.contest_id
      ORDER BY l.started_at DESC
      LIMIT 100
    `);

    const formattedDb = dbLogs.map(l => ({
      source: 'database',
      logId: l.logId,
      status: l.status,
      contestSlug: l.contestSlug,
      contestTitle: l.contestTitle,
      lastPageSynced: l.lastPageSynced,
      participantsSynced: l.participantsSynced,
      totalRequests: l.totalRequests,
      failedRequests: l.failedRequests,
      retryCount: l.retryCount,
      startedAt: l.startedAt,
      completedAt: l.completedAt,
      error: l.error,
      duration: l.duration
    }));

    return res.json({
      success: true,
      activeJobs: formattedMemory,
      history: formattedDb
    });
  } catch (err) {
    console.error('[Controller] GetSyncHistory error:', err.message);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to retrieve synchronization history.'
    });
  }
}

module.exports = {
  startSync,
  getSyncStatus,
  cancelSync,
  retrySync,
  getSyncHistory
};
