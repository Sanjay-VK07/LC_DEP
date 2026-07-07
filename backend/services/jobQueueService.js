/**
 * JobQueueService
 * ===============
 * In-process background job queue.
 * Handles: platform sync, attendance backfill, report/PDF/Excel/CSV generation,
 *          analytics recalculation, and other long-running operations.
 *
 * Each job exposes: id, type, status, progress (0-100), message, startedAt,
 *                   completedAt, error, result, createdAt.
 */

const { EventEmitter } = require('events');

const JOB_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
};

const JOB_TYPE = {
  PLATFORM_SYNC: 'PLATFORM_SYNC',
  ATTENDANCE_BACKFILL: 'ATTENDANCE_BACKFILL',
  REPORT_GENERATION: 'REPORT_GENERATION',
  PDF_GENERATION: 'PDF_GENERATION',
  EXCEL_GENERATION: 'EXCEL_GENERATION',
  CSV_GENERATION: 'CSV_GENERATION',
  ANALYTICS_RECALCULATION: 'ANALYTICS_RECALCULATION',
  LEETCODE_CONTEST_SYNC: 'LEETCODE_CONTEST_SYNC',
  CONTEST_ATTENDANCE_SYNC: 'CONTEST_ATTENDANCE_SYNC'
};

let jobIdCounter = 1;
const jobs = new Map(); // jobId -> job object

const emitter = new EventEmitter();

/**
 * Create a new job and add it to the queue.
 * @param {string} type - One of JOB_TYPE values
 * @param {object} payload - Job-specific data (serialisable)
 * @param {Function} handler - Async function(job, updateProgress) to run
 * @returns {string} jobId
 */
function enqueue(type, payload, handler) {
  const jobId = String(jobIdCounter++);
  const job = {
    id: jobId,
    type,
    status: JOB_STATUS.PENDING,
    progress: 0,
    message: 'Queued',
    payload,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    error: null,
    result: null,
    retryCount: 0
  };
  jobs.set(jobId, job);

  // Run the job asynchronously
  setImmediate(async () => {
    let attempt = 0;
    const maxRetries = 2; // Up to 2 retries (3 total attempts)

    while (attempt <= maxRetries) {
      try {
        if (attempt > 0) {
          job.message = `Retrying (Attempt #${attempt})...`;
          console.log(`[JobQueue] Retrying Job ${jobId} (${type}) - Attempt #${attempt}...`);
        } else {
          job.status = JOB_STATUS.RUNNING;
          job.startedAt = new Date().toISOString();
          job.message = 'Running';
          emitter.emit('job:started', job);
          console.log(`[JobQueue] Job ${jobId} (${type}) started.`);
        }

        const updateProgress = (progress, message) => {
          job.progress = Math.min(100, Math.max(0, progress));
          if (message) job.message = message;
          emitter.emit('job:progress', job);
        };

        const result = await handler(job, updateProgress);
        job.status = JOB_STATUS.COMPLETED;
        job.progress = 100;
        job.completedAt = new Date().toISOString();
        job.result = result || null;
        job.message = 'Completed';
        emitter.emit('job:completed', job);
        console.log(`[JobQueue] Job ${jobId} (${type}) completed.`);
        break; // Success, break retry loop
      } catch (err) {
        attempt++;
        job.retryCount = attempt;

        if (attempt > maxRetries) {
          job.status = JOB_STATUS.FAILED;
          job.completedAt = new Date().toISOString();
          job.error = err.message || String(err);
          job.message = `Failed after ${maxRetries} retries: ${job.error}`;
          emitter.emit('job:failed', job);
          console.error(`[JobQueue] Job ${jobId} (${type}) failed permanently: ${err.message}`);
        } else {
          // Linear backoff delay
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
    }
  });

  return jobId;
}

/**
 * Get a job by ID.
 * @param {string} jobId
 * @returns {object|null}
 */
function getJob(jobId) {
  return jobs.get(jobId) || null;
}

/**
 * Get all jobs. Optionally filter by type or status.
 * @param {object} filters - { type?, status? }
 * @returns {Array}
 */
function listJobs({ type, status } = {}) {
  const result = [];
  for (const job of jobs.values()) {
    if (type && job.type !== type) continue;
    if (status && job.status !== status) continue;
    result.push(job);
  }
  // Sort newest first
  return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Cancel a pending job. Running jobs cannot be cancelled here (handlers must check).
 * @param {string} jobId
 * @returns {boolean}
 */
function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  if (job.status !== JOB_STATUS.PENDING && job.status !== JOB_STATUS.RUNNING) return false;
  job.status = JOB_STATUS.CANCELLED;
  job.completedAt = new Date().toISOString();
  job.message = 'Cancelled';
  emitter.emit('job:cancelled', job);
  return true;
}

/**
 * Remove old completed/failed jobs to prevent memory leaks (keep last 200).
 */
function pruneOldJobs() {
  const all = listJobs();
  const terminal = all.filter(j =>
    j.status === JOB_STATUS.COMPLETED ||
    j.status === JOB_STATUS.FAILED ||
    j.status === JOB_STATUS.CANCELLED
  );
  if (terminal.length > 200) {
    const toDelete = terminal.slice(200);
    toDelete.forEach(j => jobs.delete(j.id));
  }
}

// Auto-prune every 30 minutes
setInterval(pruneOldJobs, 30 * 60 * 1000);

module.exports = {
  enqueue,
  getJob,
  listJobs,
  cancelJob,
  JOB_STATUS,
  JOB_TYPE,
  on: (event, listener) => emitter.on(event, listener)
};
