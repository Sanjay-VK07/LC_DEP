const SyncLockManager = require('./syncLockManager');
const EventBus = require('./EventBus');

/**
 * Concurrency-controlled synchronization queue (Singleton) for registered students.
 */
class StudentSyncQueue {
  constructor() {
    this.concurrency = 5;
    this.maxRetries = 3;
    this.timeoutMs = 15000; // 15 seconds timeout per student lookup

    // Running states
    this.activeContestId = null;
    this.pending = [];
    this.processing = new Set();
    this.completed = [];
    this.failed = [];
    this.retryMap = {}; // studentId -> retryCount
    
    this.isPaused = false;
    this.startTime = null;
    this.workers = [];
  }

  /**
   * Starts processing the registered students list.
   * @param {number} contestId - Database ID of the live contest.
   * @param {Array} students - List of students to sync.
   * @param {object} provider - The platform provider instance.
   * @param {function} syncFunc - The function containing student-specific sync logic.
   */
  async start(contestId, students, provider, syncFunc) {
    if (this.activeContestId) {
      throw new Error('Another synchronization queue run is already active.');
    }

    if (!SyncLockManager.acquire(contestId)) {
      throw new Error('Lock acquisition failed. Overlapping sync execution blocked.');
    }

    const db = require('../config/db');
    const contestRows = await db.query("SELECT contestSlug FROM LiveContests WHERE id = ?", [contestId]);
    const contestSlug = contestRows[0]?.contestSlug;

    const isTestEnv = process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT || process.argv.some(arg => arg.includes('test'));

    const isMock = !isTestEnv && (!contestSlug || 
      contestSlug.toLowerCase().startsWith('upcoming-live-') || 
      contestSlug.toLowerCase().startsWith('test-') || 
      contestSlug.toLowerCase().startsWith('mock-') || 
      contestSlug.toLowerCase().startsWith('dummy-'));

    if (isMock) {
      console.log(`[StudentSyncQueue] Skipping sync queue run for mock contest slug: "${contestSlug}"`);
      SyncLockManager.release(contestId);
      return;
    }

    this.activeContestId = contestId;
    this.pending = [...students];
    this.processing.clear();
    this.completed = [];
    this.failed = [];
    this.retryMap = {};
    this.isPaused = false;
    this.startTime = new Date();

    db.query("UPDATE LiveContests SET syncProgress = 0.00 WHERE id = ?", [contestId]).catch(err => {
      console.error('[StudentSyncQueue] Failed to reset progress in DB:', err.message);
    });

    console.log(`[StudentSyncQueue] Initialized queue for contest ID ${contestId}. Concurrency: ${this.concurrency}. Total students: ${students.length}`);

    // Broadcast sync start event
    EventBus.emit('SyncStarted', { contestId, totalStudents: students.length });

    // Pre-fetch cache if supported by provider to avoid worker timeouts
    if (typeof provider.refreshLeaderboardCache === 'function') {
      const contestRows = await db.query("SELECT contestSlug FROM LiveContests WHERE id = ?", [contestId]);
      const contestSlug = contestRows[0]?.contestSlug;
      if (contestSlug) {
        console.log(`[StudentSyncQueue] Pre-fetching leaderboard cache for contest "${contestSlug}"...`);
        try {
          await provider.refreshLeaderboardCache(contestSlug);
        } catch (err) {
          console.error(`[StudentSyncQueue] Cache pre-fetch failed for "${contestSlug}":`, err.message);
        }
      }
    }

    // Spawn workers
    this.workers = [];
    const workerCount = Math.min(this.concurrency, this.pending.length);
    for (let i = 0; i < workerCount; i++) {
      this.workers.push(this._runWorker(provider, syncFunc));
    }

    // Await execution block
    Promise.all(this.workers).then(() => {
      if (!this.isPaused) {
        this._finalizeSync();
      }
    }).catch(err => {
      console.error('[StudentSyncQueue] Worker pool execution crashed:', err.message);
      this._finalizeSync(err.message);
    });
  }

  /**
   * Internal worker execution loop.
   */
  async _runWorker(provider, syncFunc) {
    while (this.pending.length > 0 && !this.isPaused) {
      const student = this.pending.shift();
      if (!student) continue;

      this.processing.add(student.id);
      let success = false;
      const retries = this.retryMap[student.id] || 0;

      try {
        // Run sync function with a timeout guard
        await Promise.race([
          syncFunc(student, provider),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Sync request timed out')), this.timeoutMs)
          )
        ]);
        success = true;
        this.completed.push(student);
      } catch (err) {
        console.warn(`[StudentSyncQueue] Sync failed for student ${student.name} (${student.leetcode_username || 'No Handle'}): ${err.message}`);

        if (retries < this.maxRetries) {
          this.retryMap[student.id] = retries + 1;
          
          // Exponential backoff before re-queueing (e.g. 100ms * 2^retries)
          const backoffTime = 100 * Math.pow(2, retries);
          await new Promise(res => setTimeout(res, backoffTime));

          console.log(`[StudentSyncQueue] Re-queuing ${student.name} for retry ${retries + 1}/${this.maxRetries}`);
          this.pending.push(student); // Put back to queue
        } else {
          this.failed.push({ student, error: err.message });
        }
      } finally {
        this.processing.delete(student.id);
        this._updateProgressInDb().catch(e => console.error(e));
      }
    }
  }

  /**
   * Pauses the sync queue execution loop.
   */
  pause() {
    if (this.activeContestId && !this.isPaused) {
      this.isPaused = true;
      console.log('[StudentSyncQueue] Execution loop PAUSED.');
      EventBus.emit('SyncPaused', { contestId: this.activeContestId });
    }
  }

  /**
   * Resumes the paused queue.
   */
  resume(provider, syncFunc) {
    if (this.activeContestId && this.isPaused) {
      this.isPaused = false;
      console.log('[StudentSyncQueue] Execution loop RESUMED.');
      EventBus.emit('SyncResumed', { contestId: this.activeContestId });

      this.workers = [];
      const workerCount = Math.min(this.concurrency, this.pending.length);
      for (let i = 0; i < workerCount; i++) {
        this.workers.push(this._runWorker(provider, syncFunc));
      }

      Promise.all(this.workers).then(() => {
        if (!this.isPaused) {
          this._finalizeSync();
        }
      }).catch(err => {
        console.error('[StudentSyncQueue] Worker pool execution crashed on resume:', err.message);
        this._finalizeSync(err.message);
      });
    }
  }

  /**
   * Finalizes the synchronization, logs performance aggregates, and releases the sync lock.
   */
  async _finalizeSync(errorMessage = null) {
    if (!this.activeContestId) return;

    const contestId = this.activeContestId;
    const finalState = errorMessage || this.failed.length > 0 ? 'Failed' : 'Completed';
    const duration = new Date() - this.startTime;

    // Release global lock
    SyncLockManager.release(finalState);

    console.log(`[StudentSyncQueue] Finalized synchronization run. Status: ${finalState}. Duration: ${duration}ms.`);

    // Persist Sync Log record
    const db = require('../config/db');
    try {
      await db.query("UPDATE LiveContests SET syncProgress = 100.00 WHERE id = ?", [contestId]);
    } catch (e) {}
    try {
      await db.query(`
        INSERT INTO ContestSyncLog (contestId, syncStarted, syncCompleted, pagesFetched, participantsFetched, errors, duration)
        VALUES (?, ?, NOW(), 0, ?, ?, ?)
      `, [
        contestId,
        this.startTime,
        this.completed.length,
        errorMessage || (this.failed.length > 0 ? JSON.stringify(this.failed.map(f => `${f.student.name}: ${f.error}`)) : null),
        duration
      ]);
    } catch (dbErr) {
      console.error('[StudentSyncQueue] Database sync logging failure:', dbErr.message);
    }

    // Record aggregate snapshot
    const snapshotEngine = require('./snapshotEngine');
    try {
      await snapshotEngine.recordContestSnapshot(contestId);
    } catch (snapErr) {
      console.error('[StudentSyncQueue] Snapshot logging failure:', snapErr.message);
    }

    // Dispatch final notification
    EventBus.emit('ContestCompleted', {
      contestId,
      status: finalState,
      duration,
      processed: this.completed.length,
      failedCount: this.failed.length
    });

    // Reset status variables
    this.activeContestId = null;
    this.pending = [];
    this.processing.clear();
    this.completed = [];
    this.failed = [];
    this.retryMap = {};
    this.workers = [];
  }

  /**
   * Updates sync progress in the database and broadcasts details via EventBus.
   */
  async _updateProgressInDb() {
    if (!this.activeContestId) return;
    const progressData = this.getProgress();
    if (!progressData.active) return;

    const db = require('../config/db');
    try {
      await db.query(
        "UPDATE LiveContests SET syncProgress = ? WHERE id = ?",
        [progressData.progress, this.activeContestId]
      );
      EventBus.emit('SyncProgress', {
        contestId: this.activeContestId,
        progress: progressData.progress,
        pendingCount: progressData.pendingCount,
        processingCount: progressData.processingCount,
        completedCount: progressData.completedCount,
        failedCount: progressData.failedCount
      });
    } catch (err) {
      console.error('[StudentSyncQueue] Failed to update progress in DB:', err.message);
    }
  }

  /**
   * Returns progress details (concurrency checkpoint).
   */
  getProgress() {
    if (!this.activeContestId) {
      return { active: false };
    }
    const total = this.pending.length + this.processing.size + this.completed.length + this.failed.length;
    const processed = this.completed.length + this.failed.length;
    const progress = total > 0 ? (processed / total) * 100 : 0;

    return {
      active: true,
      contestId: this.activeContestId,
      progress: parseFloat(progress.toFixed(2)),
      pendingCount: this.pending.length,
      processingCount: this.processing.size,
      completedCount: this.completed.length,
      failedCount: this.failed.length,
      durationMs: new Date() - this.startTime
    };
  }
}

// Export singleton instance
module.exports = new StudentSyncQueue();
