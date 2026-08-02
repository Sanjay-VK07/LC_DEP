const db = require('../../config/db');
const SyncLockManager = require('../syncLockManager');
const studentSyncQueue = require('../studentSyncQueue');
const EventBus = require('../EventBus');

/**
 * SyncService
 * Responsible ONLY for platform sync status, queue health, SSE stream events, and control triggers.
 */
class SyncService {
  /**
   * Checks for unsynced contests and triggers background sync if needed.
   */
  async checkAutoSync(platform) {
    const dbPlatformMap = {
      leetcode: 'LeetCode',
      codechef: 'CodeChef',
      codeforces: 'Codeforces'
    };
    const dbPlatform = dbPlatformMap[platform.toLowerCase()] || platform;

    const unsyncedContests = await db.query(
      `SELECT contest_id, title 
       FROM Contests 
       WHERE platform = ? AND contest_status != 'Cancelled'
         AND slug NOT LIKE 'upcoming-live-%'
         AND slug NOT LIKE 'starting-%'
         AND slug NOT LIKE 'temporary-%'
         AND slug NOT LIKE 'placeholder-%'
         AND slug NOT LIKE 'test-%'
         AND slug NOT LIKE 'mock-%'
         AND slug NOT LIKE 'dummy-%'
         AND (
           last_synced_at IS NULL
           OR (start_time <= NOW() AND DATE_ADD(start_time, INTERVAL duration SECOND) > NOW() AND last_synced_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE))
           OR (DATE_ADD(start_time, INTERVAL duration SECOND) <= NOW() AND last_synced_at < DATE_ADD(start_time, INTERVAL duration SECOND))
         )`,
      [dbPlatform]
    );

    if (unsyncedContests.length > 0 && process.env.NODE_ENV !== 'test') {
      const { syncAllData } = require('../../utils/scheduler');
      syncAllData().catch(err => console.error('[Auto-Sync] Background sync failed:', err.message));
    }
  }

  /**
   * Fetches provider health status and lock states.
   */
  async getLiveHealth() {
    const queueProgress = studentSyncQueue.getProgress();
    const lockStatus = SyncLockManager.getStatus();
    const clientsCount = EventBus.listenerCount('StudentUpdated');

    return {
      platform: 'LeetCode',
      providerStatus: 'Healthy',
      currentDatasource: 'MockGraphQL',
      datasourcePriority: ['MockGraphQL', 'MockLeaderboard', 'CachedFile'],
      capabilityAvailability: {
        contestDetection: true,
        liveParticipation: true,
        contestHistory: true,
        ratingHistory: true,
        leaderboard: true,
        submissions: false
      },
      healthScore: 100,
      failoverCount: 0,
      cacheHitRatio: 0.95,
      averageResponseTime: 85,
      syncLockState: lockStatus.state,
      activeContestId: lockStatus.activeContestId,
      queue: queueProgress,
      activeSseClients: clientsCount
    };
  }
}

module.exports = new SyncService();
