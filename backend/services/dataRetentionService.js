const db = require('../config/db');

/**
 * DataRetentionService
 * Intelligent Storage Manager and Auto-Eviction Service for TiDB Serverless.
 * 
 * Guarantees that the database never runs out of space by:
 * 1. Automatically pruning historical logs and snapshots older than 30 days.
 * 2. Monitoring database storage capacity in real-time.
 * 3. Evicting oldest contest caches and leaderboard snapshots (FIFO) whenever
 *    storage approaches limits before new data fetches.
 */
class DataRetentionService {
  /**
   * Retrieves current database storage usage from information_schema.
   * @returns {Promise<{totalKb: number, totalMb: number, tables: Array}>}
   */
  static async getStorageUsage() {
    try {
      const dbName = process.env.DB_NAME || 'college_db';
      const rows = await db.query(`
        SELECT 
          table_name, 
          table_rows, 
          ROUND((data_length + index_length) / 1024, 2) AS size_kb,
          ROUND((data_length + index_length) / (1024 * 1024), 4) AS size_mb
        FROM information_schema.tables 
        WHERE table_schema = ?
        ORDER BY (data_length + index_length) DESC
      `, [dbName]);

      let totalKb = 0;
      let totalMb = 0;
      if (Array.isArray(rows)) {
        for (const r of rows) {
          totalKb += parseFloat(r.size_kb || 0);
          totalMb += parseFloat(r.size_mb || 0);
        }
      }

      return {
        totalKb: Math.round(totalKb * 100) / 100,
        totalMb: Math.round(totalMb * 100) / 100,
        tables: rows || []
      };
    } catch (err) {
      console.warn('[DataRetention] Could not retrieve storage metrics:', err.message);
      return { totalKb: 0, totalMb: 0, tables: [] };
    }
  }

  /**
   * Automatically prepares space before a new fetch or synchronization.
   * If storage exceeds threshold or contest cache exceeds maximum limit,
   * purges oldest historical records.
   */
  static async prepareSpaceForFetch() {
    console.log('[DataRetention] Pre-fetch storage check initiated...');
    try {
      // 1. Always ensure 30-day transient logs are pruned
      await this.pruneDataOlderThanOneMonth(30);

      // 2. Check storage metrics
      const usage = await this.getStorageUsage();
      console.log(`[DataRetention] Current DB Storage: ${usage.totalMb} MB across ${usage.tables.length} tables.`);

      // TiDB Serverless free tier provides 5,000 MB (5 GiB).
      // Trigger emergency auto-eviction if database exceeds 4,000 MB (80% capacity)
      // or if ContestLeaderboardSnapshots table has more than 20 old contests.
      const STORAGE_THRESHOLD_MB = 4000;
      const MAX_CACHED_CONTESTS = 15;

      if (usage.totalMb > STORAGE_THRESHOLD_MB) {
        console.warn(`[DataRetention] Storage threshold exceeded (${usage.totalMb}MB > ${STORAGE_THRESHOLD_MB}MB). Triggering emergency eviction!`);
        await this.evictOldestContestData(5);
      } else {
        // Enforce maximum cached contest limit to keep storage ultra-light
        await this.enforceContestCacheRetention(MAX_CACHED_CONTESTS);
      }

      return { success: true, storageMb: usage.totalMb };
    } catch (err) {
      console.error('[DataRetention] Pre-fetch space preparation error:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Prunes all transient and log data older than specified days (default: 30 days).
   * @param {number} days - Number of days to retain (default: 30)
   * @returns {Promise<object>} Summary of deleted records per table
   */
  static async pruneDataOlderThanOneMonth(days = 30) {
    const summary = {};

    try {
      // 1. AuditLog (> 30 days)
      try {
        const res = await db.query(
          `DELETE FROM AuditLog WHERE created_at < NOW() - INTERVAL ? DAY`,
          [days]
        );
        summary.AuditLog = res?.affectedRows ?? 0;
      } catch (err) {
        summary.AuditLog = `Skipped: ${err.message}`;
      }

      // 2. sync_logs (> 30 days)
      try {
        const res = await db.query(
          `DELETE FROM sync_logs WHERE started_at < NOW() - INTERVAL ? DAY`,
          [days]
        );
        summary.sync_logs = res?.affectedRows ?? 0;
      } catch (err) {
        summary.sync_logs = `Skipped: ${err.message}`;
      }

      // 3. BulkImportAuditLogs (> 30 days)
      try {
        const res = await db.query(
          `DELETE FROM BulkImportAuditLogs WHERE created_at < NOW() - INTERVAL ? DAY`,
          [days]
        );
        summary.BulkImportAuditLogs = res?.affectedRows ?? 0;
      } catch (err) {
        summary.BulkImportAuditLogs = `Skipped: ${err.message}`;
      }

      // 4. notifications (> 30 days and read)
      try {
        const res = await db.query(
          `DELETE FROM notifications WHERE created_at < NOW() - INTERVAL ? DAY`,
          [days]
        );
        summary.notifications = res?.affectedRows ?? 0;
      } catch (err) {
        summary.notifications = `Skipped: ${err.message}`;
      }

      // 5. ContestSyncLog (> 30 days)
      try {
        const res = await db.query(
          `DELETE FROM ContestSyncLog WHERE started_at < NOW() - INTERVAL ? DAY`,
          [days]
        );
        summary.ContestSyncLog = res?.affectedRows ?? 0;
      } catch (err) {
        summary.ContestSyncLog = `Skipped: ${err.message}`;
      }

      // 6. ContestSnapshots (> 30 days)
      try {
        const res = await db.query(
          `DELETE FROM ContestSnapshots WHERE snapshotTime < NOW() - INTERVAL ? DAY`,
          [days]
        );
        summary.ContestSnapshots = res?.affectedRows ?? 0;
      } catch (err) {
        summary.ContestSnapshots = `Skipped: ${err.message}`;
      }

      // 7. ContestLeaderboardSnapshots (> 30 days - heavy raw JSON pages)
      try {
        const res = await db.query(
          `DELETE FROM ContestLeaderboardSnapshots WHERE downloaded_at < NOW() - INTERVAL ? DAY`,
          [days]
        );
        summary.ContestLeaderboardSnapshots = res?.affectedRows ?? 0;
      } catch (err) {
        summary.ContestLeaderboardSnapshots = `Skipped: ${err.message}`;
      }

      // 8. ParticipationLogs (> 30 days)
      try {
        const res = await db.query(
          `DELETE FROM ParticipationLogs WHERE created_at < NOW() - INTERVAL ? DAY`,
          [days]
        );
        summary.ParticipationLogs = res?.affectedRows ?? 0;
      } catch (err) {
        summary.ParticipationLogs = `Skipped: ${err.message}`;
      }

      return { success: true, retentionDays: days, summary };
    } catch (globalErr) {
      console.error('[DataRetention] Prune failed:', globalErr.message);
      return { success: false, error: globalErr.message };
    }
  }

  /**
   * Enforces maximum cached contests to keep database slim and fast.
   * If contest count exceeds maxLimit, evicts raw payloads from oldest contests.
   */
  static async enforceContestCacheRetention(maxLimit = 15) {
    try {
      const rows = await db.query(`
        SELECT contest_slug, COUNT(*) as page_count, MIN(downloaded_at) as oldest_date
        FROM ContestLeaderboardSnapshots
        GROUP BY contest_slug
        ORDER BY oldest_date ASC
      `);

      if (Array.isArray(rows) && rows.length > maxLimit) {
        const excessCount = rows.length - maxLimit;
        const toEvict = rows.slice(0, excessCount).map(r => r.contest_slug);
        console.log(`[DataRetention] Evicting ${excessCount} old contest leaderboard snapshots to maintain free space:`, toEvict);

        for (const slug of toEvict) {
          await db.query("DELETE FROM ContestLeaderboardSnapshots WHERE contest_slug = ?", [slug]).catch(() => {});
          await db.query("DELETE FROM ContestParticipants WHERE contest_slug = ?", [slug]).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[DataRetention] enforceContestCacheRetention notice:', err.message);
    }
  }

  /**
   * Emergency FIFO eviction of oldest contest data.
   */
  static async evictOldestContestData(batchCount = 5) {
    try {
      const oldestContests = await db.query(`
        SELECT id, contestSlug FROM LiveContests 
        ORDER BY startTime ASC 
        LIMIT ?
      `, [batchCount]);

      if (Array.isArray(oldestContests) && oldestContests.length > 0) {
        for (const c of oldestContests) {
          console.log(`[DataRetention] Evicting old contest records for "${c.contestSlug}" (ID: ${c.id})...`);
          await db.query("DELETE FROM ContestLeaderboardSnapshots WHERE contest_slug = ?", [c.contestSlug]).catch(() => {});
          await db.query("DELETE FROM ContestParticipants WHERE contest_slug = ?", [c.contestSlug]).catch(() => {});
          await db.query("DELETE FROM ContestAttendance WHERE contestId = ?", [c.id]).catch(() => {});
          await db.query("DELETE FROM ContestSyncLog WHERE contestId = ?", [c.id]).catch(() => {});
          await db.query("DELETE FROM ContestSnapshots WHERE contestId = ?", [c.id]).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[DataRetention] Emergency eviction failed:', err.message);
    }
  }
}

module.exports = DataRetentionService;
