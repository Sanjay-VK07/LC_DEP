/**
 * jobController.js (NEW)
 * =======================
 * Exposes background job status, progress, and management endpoints.
 */

const jobQueue = require('../services/jobQueueService');
const cache = require('../services/analyticsCacheService');
const auditLog = require('../services/auditLogService');

/**
 * List all jobs (optionally filtered by type/status).
 */
async function listJobs(req, res) {
  const { type, status } = req.query;
  try {
    const jobs = jobQueue.listJobs({ type, status });
    return res.json({ success: true, count: jobs.length, data: jobs });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to list jobs' });
  }
}

/**
 * Get a specific job by ID.
 */
async function getJob(req, res) {
  const { id } = req.params;
  const job = jobQueue.getJob(id);
  if (!job) {
    return res.status(404).json({ success: false, message: `Job ${id} not found` });
  }
  return res.json({ success: true, data: job });
}

/**
 * Cancel a pending job.
 */
async function cancelJob(req, res) {
  const { id } = req.params;
  const cancelled = jobQueue.cancelJob(id);
  if (!cancelled) {
    return res.status(400).json({ success: false, message: `Job ${id} cannot be cancelled (not found or already running)` });
  }
  return res.json({ success: true, message: `Job ${id} cancelled` });
}

/**
 * Trigger a manual platform sync as a background job.
 */
async function triggerSyncJob(req, res) {
  const { syncAllData } = require('../utils/scheduler');
  const { invalidateAll } = require('../services/analyticsCacheService');

  const jobId = jobQueue.enqueue(
    jobQueue.JOB_TYPE.PLATFORM_SYNC,
    { triggeredBy: 'manual', timestamp: new Date().toISOString() },
    async (job, updateProgress) => {
      updateProgress(5, 'Starting platform synchronization...');
      const result = await syncAllData();
      updateProgress(95, 'Invalidating analytics cache...');
      invalidateAll();
      updateProgress(100, 'Sync completed');
      return result;
    }
  );

  await auditLog.log(auditLog.AUDIT_ACTIONS.JOB_ENQUEUED, {
    details: { jobId, type: 'PLATFORM_SYNC', trigger: 'manual' }
  });

  return res.json({
    success: true,
    message: 'Platform sync job enqueued',
    jobId
  });
}

/**
 * Trigger analytics recalculation as a background job.
 */
async function triggerAnalyticsRecalc(req, res) {
  const jobId = jobQueue.enqueue(
    jobQueue.JOB_TYPE.ANALYTICS_RECALCULATION,
    { triggeredBy: 'manual' },
    async (job, updateProgress) => {
      updateProgress(10, 'Clearing analytics cache...');
      cache.invalidateAll();
      updateProgress(50, 'Pre-computing dashboard metrics...');
      const dashboardMetrics = require('../services/dashboardMetricsService');
      await dashboardMetrics.getDashboardStats();
      updateProgress(80, 'Pre-computing leaderboards...');
      const platformAnalytics = require('../services/platformAnalyticsService');
      await platformAnalytics.getLeaderboards({});
      updateProgress(100, 'Analytics recalculated');
      return { success: true, message: 'Analytics recalculation complete' };
    }
  );

  return res.json({ success: true, message: 'Analytics recalculation job enqueued', jobId });
}

/**
 * Get cache statistics.
 */
async function getCacheStats(req, res) {
  const stats = cache.getStats();
  return res.json({ success: true, cache: stats });
}

/**
 * Manually invalidate the analytics cache.
 */
async function invalidateCache(req, res) {
  cache.invalidateAll();
  await auditLog.log(auditLog.AUDIT_ACTIONS.CACHE_INVALIDATED, {
    details: { trigger: 'manual_api_call' }
  });
  return res.json({ success: true, message: 'Analytics cache cleared successfully' });
}

const attendanceService = require('../services/attendanceService');
const fs = require('fs');

/**
 * Trigger background attendance backfill.
 */
async function triggerAttendanceBackfill(req, res) {
  const { userId } = req.body;

  const jobId = jobQueue.enqueue(
    'ATTENDANCE_BACKFILL',
    { userId },
    async (job, updateProgress) => {
      updateProgress(5, 'Starting attendance backfill...');
      const result = await attendanceService.backfillAttendance(userId, updateProgress);
      return result;
    }
  );

  await auditLog.log(auditLog.AUDIT_ACTIONS.JOB_ENQUEUED, {
    details: { jobId, type: 'ATTENDANCE_BACKFILL', userId }
  });

  return res.json({ success: true, message: 'Attendance backfill job enqueued', jobId });
}

/**
 * Download generated export file for a completed export job.
 */
async function downloadJobFile(req, res) {
  const { id } = req.params;
  const job = jobQueue.getJob(id);
  if (!job) {
    return res.status(404).json({ success: false, message: `Job ${id} not found` });
  }
  if (job.status !== 'COMPLETED') {
    return res.status(400).json({ success: false, message: `Job ${id} is not completed (status: ${job.status})` });
  }
  const result = job.result;
  if (!result || !result.filePath) {
    return res.status(400).json({ success: false, message: 'No file available for this job' });
  }

  if (!fs.existsSync(result.filePath)) {
    return res.status(410).json({ success: false, message: 'File is no longer available or was cleaned up' });
  }

  return res.download(result.filePath, result.filename);
}

module.exports = {
  listJobs,
  getJob,
  cancelJob,
  triggerSyncJob,
  triggerAnalyticsRecalc,
  getCacheStats,
  invalidateCache,
  triggerAttendanceBackfill,
  downloadJobFile
};
