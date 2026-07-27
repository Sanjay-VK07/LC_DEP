const db = require('../config/db');
const studentSyncQueue = require('./studentSyncQueue');
const snapshotEngine = require('./snapshotEngine');
const LeetCodeProvider = require('./connectors/LeetCodeProvider');
const MockProvider = require('./connectors/MockProvider');
const FeatureFlags = require('../config/featureFlags');

/**
 * Background loop manager (Singleton) that orchestrates live contest checks and schedules sync runs.
 */
class LiveContestScheduler {
  constructor() {
    this.intervalId = null;
    this.detectIntervalId = null;
    this.syncIntervalMs = 60 * 1000; // Check contest state every minute
    this.detectIntervalMs = 60 * 60 * 1000; // Query provider for new contests hourly
    this.leetcodeProvider = new LeetCodeProvider();
    this.mockProvider = new MockProvider();
  }

  /**
   * Starts background loops for live checks and contest discovery.
   */
  start() {
    if (this.intervalId) return;

    console.log('[LiveContestScheduler] Initializing background contest schedulers...');
    
    // Check for live updates
    this._checkLiveContests();
    this.intervalId = setInterval(() => this._checkLiveContests(), this.syncIntervalMs);

    // Hourly detection scans
    this._runContestDetection();
    this.detectIntervalId = setInterval(() => this._runContestDetection(), this.detectIntervalMs);
  }

  /**
   * Stops background schedulers.
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.detectIntervalId) {
      clearInterval(this.detectIntervalId);
      this.detectIntervalId = null;
    }
    console.log('[LiveContestScheduler] Background scheduler loops stopped.');
  }

  /**
   * Core poll method evaluating live, synchronizing, and upcoming contest windows.
   */
  async _checkLiveContests() {
    try {
      const now = new Date();

      const isMockContestSlug = (slug) => {
        const isTestEnv = process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT || process.argv.some(arg => arg.includes('test'));
        if (isTestEnv) return false;
        if (!slug) return true;
        const lower = slug.toLowerCase();
        return lower.startsWith('upcoming-live-') || 
               lower.startsWith('test-') || 
               lower.startsWith('mock-') || 
               lower.startsWith('dummy-');
      };

      // 1. Process active/live contests
      const liveContests = await db.query(
        "SELECT * FROM LiveContests WHERE status IN ('Live', 'Synchronizing')"
      );

      for (const contest of liveContests) {
        try {
          if (isMockContestSlug(contest.contestSlug)) {
            continue;
          }

          const endTime = new Date(contest.endTime);
          const lastSync = contest.lastSyncAt ? new Date(contest.lastSyncAt) : null;
          const timeSinceLastSync = lastSync ? (now - lastSync) : Infinity;
          const pass = contest.currentSyncPass || 0;

          if (now > endTime) {
            // Contest ended: coordinate multi-pass synchronization stages
            if (pass === 0) {
              console.log(`[LiveContestScheduler] Contest "${contest.contestName}" ended. Initiating Sync Pass #1...`);
              await this._triggerSyncPass(contest.id, 1);
            } else if (pass === 1 && timeSinceLastSync >= 10 * 60 * 1000) {
              console.log(`[LiveContestScheduler] 10 minutes elapsed since Pass 1. Initiating Sync Pass #2...`);
              await this._triggerSyncPass(contest.id, 2);
            } else if (pass === 2 && timeSinceLastSync >= 30 * 60 * 1000) {
              console.log(`[LiveContestScheduler] 30 minutes elapsed since Pass 2. Initiating Sync Pass #3...`);
              await this._triggerSyncPass(contest.id, 3);
            } else if (pass === 3 && timeSinceLastSync >= 120 * 60 * 1000) {
              console.log(`[LiveContestScheduler] 2 hours elapsed since Pass 3. Initiating Sync Pass #4 (Final Verification)...`);
              await this._triggerSyncPass(contest.id, 4);
            }
          } else {
            // Contest running: sync periodically every 5 minutes
            if (timeSinceLastSync >= 5 * 60 * 1000) {
              console.log(`[LiveContestScheduler] Live sync interval reached. Triggering Sync Pass #0 for: "${contest.contestName}"`);
              await this._triggerSyncPass(contest.id, 0);
            }
          }
        } catch (itemErr) {
          console.error(`[LiveContestScheduler] Error processing live contest ID ${contest?.id}:`, itemErr.message);
        }
      }

      // 2. Promote upcoming contests to live when their startTime arrives
      const upcomingContests = await db.query(
        "SELECT * FROM LiveContests WHERE status = 'Upcoming' AND startTime <= NOW()"
      );

      for (const contest of upcomingContests) {
        try {
          if (isMockContestSlug(contest.contestSlug)) {
            continue;
          }

          console.log(`[LiveContestScheduler] Upcoming contest "${contest.contestName}" is starting. Transitioning state to Live.`);
          await db.query("UPDATE LiveContests SET status = 'Live', currentSyncPass = 0 WHERE id = ?", [contest.id]);
          await this._triggerSyncPass(contest.id, 0);
        } catch (itemErr) {
          console.error(`[LiveContestScheduler] Error processing upcoming contest ID ${contest?.id}:`, itemErr.message);
        }
      }
    } catch (err) {
      console.error('[LiveContestScheduler] State check loop exception:', err.message);
    }
  }

  /**
   * Invokes the concurrent sync queue for a live contest.
   */
  async _triggerSync(contestId) {
    return this._triggerSyncPass(contestId, 0);
  }

  /**
   * Finalizes the contest attendance record mappings.
   */
  async _finalizeContest(contestId) {
    return this._triggerSyncPass(contestId, 4);
  }

  /**
   * Triggers a specific synchronization pass (0=live intermediate, 1-3=stages, 4=final verification)
   */
  async _triggerSyncPass(contestId, pass) {
    const jobQueue = require('./jobQueueService');
    const ContestAttendanceSyncService = require('./ContestAttendanceSyncService');

    // Check if a sync job is already running for this contest and pass
    const activeJobs = jobQueue.listJobs({
      type: jobQueue.JOB_TYPE.CONTEST_ATTENDANCE_SYNC,
      status: jobQueue.JOB_STATUS.RUNNING
    });
    const isAlreadyRunning = activeJobs.some(j => j.payload?.contestId === contestId && j.payload?.pass === pass);
    if (isAlreadyRunning) {
      console.log(`[LiveContestScheduler] Sync Pass #${pass} is already running in background for contest ID: ${contestId}. Skipping duplicate enqueue.`);
      return;
    }

    try {
      await db.query(
        "UPDATE LiveContests SET status = 'Synchronizing', lastSyncAt = NOW(), currentSyncPass = ? WHERE id = ?", 
        [pass, contestId]
      );

      // Enqueue the job in the background queue
      jobQueue.enqueue(
        jobQueue.JOB_TYPE.CONTEST_ATTENDANCE_SYNC,
        { contestId, pass },
        async (job, updateProgress) => {
          const result = await ContestAttendanceSyncService.syncContestAttendance(contestId, {
            pass,
            jobId: job.id,
            updateProgress
          });

          // Finalize contest status on pass 4 completion
          const EventBus = require('./EventBus');
          if (pass === 4) {
            await db.query(
              "UPDATE LiveContests SET status = 'Completed', lastSyncAt = NOW() WHERE id = ?", 
              [contestId]
            );
            console.log(`[LiveContestScheduler] Final Sync Pass #4 complete. Contest ID ${contestId} finalized.`);
            EventBus.emit('ContestCompleted', { contestId, status: 'Completed', pass });
          } else {
            const nextStatus = pass === 0 ? 'Live' : 'Synchronizing';
            await db.query(
              "UPDATE LiveContests SET status = ?, lastSyncAt = NOW() WHERE id = ?", 
              [nextStatus, contestId]
            );
            console.log(`[LiveContestScheduler] Sync Pass #${pass} completed successfully for contest ID ${contestId}.`);
            EventBus.emit('ContestCompleted', { contestId, status: nextStatus, pass });
          }

          return result;
        }
      );

      console.log(`[LiveContestScheduler] Enqueued Sync Pass #${pass} for contest ID: ${contestId}`);
    } catch (err) {
      console.error(`[LiveContestScheduler] Failed to enqueue sync job for contest ID ${contestId}:`, err.message);
      const failStatus = pass === 0 ? 'Live' : 'Synchronizing';
      try {
        await db.query("UPDATE LiveContests SET status = ? WHERE id = ?", [failStatus, contestId]);
      } catch (dbErr) {
        console.error(`[LiveContestScheduler] Failed to update fallback status in DB for contest ID ${contestId}:`, dbErr.message);
      }
    }
  }

  /**
   * Seeding process querying the provider for upcoming and live contests.
   */
  async _runContestDetection() {
    console.log('[LiveContestScheduler] Executing contest discovery scan...');
    try {
      const provider = FeatureFlags.isEnabled('graphql') ? this.leetcodeProvider : this.mockProvider;
      const list = await provider.detectContest();

      for (const c of list) {
        await db.query(`
          INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            contestName = VALUES(contestName),
            startTime = VALUES(startTime),
            endTime = VALUES(endTime)
        `, [
          c.platform,
          c.contestSlug,
          c.contestName,
          c.contestType,
          c.startTime,
          c.endTime,
          c.status
        ]);

        // Ensure foreign-key consistency: matching Contests record exists
        const slug = c.contestSlug;
        const title = c.contestName || slug;
        const contestType = c.contestType || (slug.includes('biweekly') ? 'Biweekly' : 'Weekly');
        const match = slug.match(/contest-(\d+)/i) || slug.match(/starters-(\d+)/i) || slug.match(/(\d+)/);
        const contestNumber = match ? parseInt(match[1], 10) : 0;
        const startTimeDate = c.startTime ? new Date(c.startTime) : new Date();

        await db.query(`
          INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
          VALUES (?, ?, ?, ?, ?, 5400, 'Rated', ?, 'SCHEDULER')
          ON DUPLICATE KEY UPDATE title = VALUES(title), start_time = VALUES(start_time)
        `, [title, slug, contestType, contestNumber, startTimeDate, c.platform || 'LeetCode']);
      }
      console.log(`[LiveContestScheduler] Discovery scan finished. Synced ${list.length} contests.`);
    } catch (err) {
      console.error('[LiveContestScheduler] Discovery scan exception:', err.message);
    }
  }
}

module.exports = new LiveContestScheduler();
