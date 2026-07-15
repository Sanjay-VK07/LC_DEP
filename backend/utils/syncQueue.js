const db = require('../config/db');

class SyncQueue {
  constructor() {
    this.processing = false;
    this.timeoutId = null;
  }

  // Start the periodic background queue processor
  startProcessing() {
    if (this.timeoutId) return;
    
    const run = async () => {
      await this.processNextBatch();
      // Poll every 10 seconds
      this.timeoutId = setTimeout(run, 10000);
      if (this.timeoutId && typeof this.timeoutId.unref === 'function') {
        this.timeoutId.unref();
      }
    };
    
    run();
    console.log('[SyncQueue] Started background sync queue polling (10s interval).');
  }

  // Trigger immediate check (wake up if idle)
  trigger() {
    console.log('[SyncQueue] Triggered immediate sync queue processing check.');
    if (!this.processing) {
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      this.startProcessing();
    }
  }

  // Process next batch of pending syncs
  async processNextBatch() {
    if (this.processing) return;
    this.processing = true;

    try {
      // Find all pending/failed sync records ready to run
      const pendingJobs = await db.query(`
        SELECT user_id, platform, username 
        FROM StudentPlatformSync 
        WHERE sync_status IN ('Never Synced', 'Pending')
           OR (sync_status = 'Failed' AND next_retry IS NOT NULL AND next_retry <= NOW())
        LIMIT 50
      `);

      if (pendingJobs.length > 0) {
        console.log(`[SyncQueue] Found ${pendingJobs.length} pending sync jobs in DB. Processing sequentially...`);
        const { syncStudentPlatform } = require('./scheduler');
        
        for (const job of pendingJobs) {
          try {
            console.log(`[SyncQueue] Processing sync for User ID ${job.user_id} on platform ${job.platform}`);
            await syncStudentPlatform(job.user_id, job.platform, true); // forceSync = true
          } catch (err) {
            console.error(`[SyncQueue] Job failed for User ID ${job.user_id} / Platform ${job.platform}:`, err.message);
          }
          // Sleep for 1.5 seconds to respect platform rate limits
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        console.log('[SyncQueue] Finished processing current batch of sync jobs.');
      }
    } catch (err) {
      console.error('[SyncQueue] Error processing sync queue:', err.message);
    } finally {
      this.processing = false;
    }
  }

  // Queue a verification sync request by upserting a "Never Synced" record
  async enqueue(userId, platform, username) {
    if (!username || !username.trim()) return;
    try {
      await db.query(`
        INSERT INTO StudentPlatformSync (user_id, platform, username, sync_status, last_attempt, retry_count)
        VALUES (?, ?, ?, 'Never Synced', NULL, 0)
        ON DUPLICATE KEY UPDATE
          username = VALUES(username),
          sync_status = CASE 
            WHEN sync_status IN ('Healthy', 'Partial') AND username = VALUES(username) THEN sync_status 
            ELSE 'Never Synced' 
          END,
          retry_count = 0
      `, [userId, platform.toLowerCase(), username.trim()]);
      
      this.trigger();
    } catch (err) {
      console.error(`[SyncQueue] Failed to enqueue sync for user ${userId} on platform ${platform}:`, err.message);
    }
  }
}

const syncQueueInstance = new SyncQueue();
module.exports = syncQueueInstance;
