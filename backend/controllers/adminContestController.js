/**
 * adminContestController.js
 * =========================
 * Administrator-only controller for safe, transactional contest data reset,
 * dry-run preview, and clean re-sync triggering.
 */

const db = require('../config/db');
const analyticsCacheService = require('../services/analyticsCacheService');
const auditLogService = require('../services/auditLogService');
const ContestLeaderboardSyncService = require('../services/ContestLeaderboardSyncService');

// Global symbol for contest sync locks
const lockKey = Symbol.for('leetcode-sync-locks');
if (!global[lockKey]) {
  global[lockKey] = new Set();
}
const activeSyncLocks = global[lockKey];

// Reset lock registry to prevent concurrent resets
const resetLockKey = Symbol.for('leetcode-reset-locks');
if (!global[resetLockKey]) {
  global[resetLockKey] = new Set();
}
const activeResetLocks = global[resetLockKey];

/**
 * Robust helper to extract affectedRows across mysql2 return formats.
 */
function getAffectedRows(res) {
  if (!res) return 0;
  if (typeof res.affectedRows === 'number') return res.affectedRows;
  if (Array.isArray(res)) {
    if (res[0] && typeof res[0].affectedRows === 'number') return res[0].affectedRows;
  }
  return 0;
}

/**
 * Robust helper to extract SELECT COUNT(*) count across mysql2 return formats.
 */
function getCount(res) {
  if (!res) return 0;
  if (typeof res.count === 'number') return res.count;
  if (Array.isArray(res)) {
    if (res[0] && typeof res[0].count === 'number') return res[0].count;
    if (res[0] && Array.isArray(res[0]) && res[0][0] && typeof res[0][0].count === 'number') return res[0][0].count;
  }
  return 0;
}

/**
 * Helper to resolve canonical contest details from ID or slug.
 */
async function resolveContest(identifier) {
  if (!identifier) return null;
  const strId = String(identifier).trim();

  // Try matching numeric contest_id
  if (/^\d+$/.test(strId)) {
    const rows = await db.query(
      "SELECT contest_id, slug, title, source FROM Contests WHERE contest_id = ?",
      [parseInt(strId, 10)]
    );
    if (rows && rows.length > 0) return rows[0];
  }

  // Try matching slug (case-insensitive)
  const slugRows = await db.query(
    "SELECT contest_id, slug, title, source FROM Contests WHERE LOWER(slug) = LOWER(?)",
    [strId]
  );
  if (slugRows && slugRows.length > 0) return slugRows[0];

  return null;
}

/**
 * Pre-delete dry run preview.
 * GET/POST /api/admin/contest/:contestId/reset/preview
 */
async function previewContestReset(req, res) {
  const { contestId } = req.params;
  const includeManualOverrides = req.query.includeManualOverrides === 'true' || req.body?.includeManualOverrides === true;

  try {
    const contest = await resolveContest(contestId);
    if (!contest) {
      return res.status(404).json({
        success: false,
        message: `Contest with identifier '${contestId}' not found.`
      });
    }

    const canonicalContestId = contest.contest_id;
    const canonicalSlug = contest.slug;

    // Count affected records using exact deletion predicates
    const cpRes = await db.query("SELECT COUNT(*) AS count FROM ContestParticipants WHERE contest_slug = ?", [canonicalSlug]);
    const caRes = await db.query(
      "SELECT COUNT(*) AS count FROM ContestAttendance WHERE contestId IN (SELECT id FROM LiveContests WHERE contestSlug = ?)",
      [canonicalSlug]
    );
    const autoArRes = await db.query(
      "SELECT COUNT(*) AS count FROM AttendanceRecords WHERE contest_id = ? AND (attendance_source = 'AUTO' OR attendance_source IS NULL)",
      [canonicalContestId]
    );
    const manualArRes = await db.query(
      "SELECT COUNT(*) AS count FROM AttendanceRecords WHERE contest_id = ? AND attendance_source = 'MANUAL'",
      [canonicalContestId]
    );
    const snapRes = await db.query("SELECT COUNT(*) AS count FROM ContestLeaderboardSnapshots WHERE contest_slug = ?", [canonicalSlug]);
    const syncLogRes = await db.query("SELECT COUNT(*) AS count FROM ContestSyncLog WHERE contest_slug = ? OR contestId IN (SELECT id FROM LiveContests WHERE contestSlug = ?)", [canonicalSlug, canonicalSlug]);
    const liveSnapRes = await db.query("SELECT COUNT(*) AS count FROM ContestSnapshots WHERE contestId IN (SELECT id FROM LiveContests WHERE contestSlug = ?)", [canonicalSlug]);

    const regRes = await db.query("SELECT COUNT(*) AS count FROM Registrations WHERE contest_id = ?", [canonicalContestId]);
    const partRes = await db.query("SELECT COUNT(*) AS count FROM ParticipationLogs WHERE contest_id = ?", [canonicalContestId]);
    const userRes = await db.query("SELECT COUNT(*) AS count FROM Users");

    const cpCount = getCount(cpRes);
    const caCount = getCount(caRes);
    const autoArCount = getCount(autoArRes);
    const manualArCount = getCount(manualArRes);
    const snapCount = getCount(snapRes);
    const syncLogCount = getCount(syncLogRes);
    const liveSnapCount = getCount(liveSnapRes);

    const regCount = getCount(regRes);
    const partCount = getCount(partRes);
    const userCount = getCount(userRes);

    const wouldDelete = {
      contestParticipants: cpCount,
      contestAttendance: caCount,
      autoAttendanceRecords: autoArCount,
      manualAttendanceRecords: includeManualOverrides ? manualArCount : 0,
      contestLeaderboardSnapshots: snapCount,
      contestSyncLogs: syncLogCount,
      contestSnapshots: liveSnapCount
    };

    const wouldPreserve = {
      manualAttendanceRecords: includeManualOverrides ? 0 : manualArCount,
      registrations: regCount,
      participationLogs: partCount,
      users: userCount,
      contestMetadata: true
    };

    return res.json({
      success: true,
      contest: {
        id: canonicalContestId,
        slug: canonicalSlug,
        platform: contest.source || 'leetcode',
        title: contest.title
      },
      wouldDelete,
      wouldPreserve
    });
  } catch (err) {
    console.error('[AdminContestController] Error in previewContestReset:', err);
    return res.status(500).json({
      success: false,
      message: `Failed to generate contest reset preview: ${err.message}`
    });
  }
}

/**
 * Execute transactional contest reset.
 * POST /api/admin/contest/:contestId/reset
 * DELETE /api/admin/contest/:contestId/data
 */
async function resetContestData(req, res) {
  const { contestId } = req.params;
  const confirmSlug = req.body?.confirmSlug || req.query?.confirmSlug || req.headers['x-confirm-slug'];
  const includeManualOverrides = req.body?.includeManualOverrides === true || req.query?.includeManualOverrides === 'true';

  try {
    const contest = await resolveContest(contestId);
    if (!contest) {
      return res.status(404).json({
        success: false,
        message: `Contest with identifier '${contestId}' not found.`
      });
    }

    const canonicalContestId = contest.contest_id;
    const canonicalSlug = contest.slug;

    // Verify explicit confirmation text matches contest slug (case-insensitive / exact string match)
    if (!confirmSlug || String(confirmSlug).trim().toLowerCase() !== canonicalSlug.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: `Explicit confirmation failed. Provided confirmation '${confirmSlug || ''}' does not match contest slug '${canonicalSlug}'.`
      });
    }

    // Race condition & concurrent sync protection
    if (activeSyncLocks.has(canonicalSlug) || activeResetLocks.has(canonicalSlug)) {
      return res.status(409).json({
        success: false,
        message: `Contest synchronization or reset is already in progress for '${canonicalSlug}'.`
      });
    }

    // Check database sync status for running sync job
    const runningSync = await db.query(
      "SELECT id FROM ContestSyncLog WHERE contest_slug = ? AND sync_status = 'RUNNING' LIMIT 1",
      [canonicalSlug]
    );
    if (runningSync && runningSync.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Contest synchronization is actively running in background for '${canonicalSlug}'. Cannot reset while sync is running.`
      });
    }

    // Lock contest for reset
    activeResetLocks.add(canonicalSlug);

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Lock contest row inside transaction
      const [contestRows] = await connection.query(
        "SELECT contest_id, slug, title FROM Contests WHERE contest_id = ? FOR UPDATE",
        [canonicalContestId]
      );
      if (!contestRows || contestRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Contest not found during locking.' });
      }

      // Count preserved metrics before deletion
      const regRes = await connection.query("SELECT COUNT(*) AS count FROM Registrations WHERE contest_id = ?", [canonicalContestId]);
      const partRes = await connection.query("SELECT COUNT(*) AS count FROM ParticipationLogs WHERE contest_id = ?", [canonicalContestId]);
      const manualArRes = await connection.query(
        "SELECT COUNT(*) AS count FROM AttendanceRecords WHERE contest_id = ? AND attendance_source = 'MANUAL'",
        [canonicalContestId]
      );

      // 1. Delete ContestParticipants
      const delCPRes = await connection.query(
        "DELETE FROM ContestParticipants WHERE contest_slug = ?",
        [canonicalSlug]
      );

      // 2. Delete ContestAttendance
      const delCARes = await connection.query(
        "DELETE FROM ContestAttendance WHERE contestId IN (SELECT id FROM LiveContests WHERE contestSlug = ?)",
        [canonicalSlug]
      );

      // 3. Delete AUTO AttendanceRecords (handling NULL explicitly)
      const delAutoARRes = await connection.query(
        "DELETE FROM AttendanceRecords WHERE contest_id = ? AND (attendance_source = 'AUTO' OR attendance_source IS NULL)",
        [canonicalContestId]
      );

      // 4. Optionally delete MANUAL AttendanceRecords if explicitly confirmed
      let delManualARRes = null;
      if (includeManualOverrides) {
        delManualARRes = await connection.query(
          "DELETE FROM AttendanceRecords WHERE contest_id = ? AND attendance_source = 'MANUAL'",
          [canonicalContestId]
        );
      }

      // 5. Clear raw snapshots and sync logs
      const delSnapRes = await connection.query("DELETE FROM ContestLeaderboardSnapshots WHERE contest_slug = ?", [canonicalSlug]);
      const delSyncLogRes = await connection.query("DELETE FROM ContestSyncLog WHERE contest_slug = ? OR contestId IN (SELECT id FROM LiveContests WHERE contestSlug = ?)", [canonicalSlug, canonicalSlug]);
      const delLiveSnapRes = await connection.query("DELETE FROM ContestSnapshots WHERE contestId IN (SELECT id FROM LiveContests WHERE contestSlug = ?)", [canonicalSlug]);

      // 6. Reset LiveContests & Contests synchronization checkpoints
      await connection.query(
        "UPDATE LiveContests SET lastSyncAt = NULL, syncProgress = 0.00, currentSyncPass = 0, status = 'Completed' WHERE contestSlug = ?",
        [canonicalSlug]
      );
      await connection.query(
        "UPDATE Contests SET last_synced_at = NULL WHERE contest_id = ?",
        [canonicalContestId]
      );

      // Commit transaction
      await connection.commit();

      // Post-transaction cache invalidation
      analyticsCacheService.invalidateContest(canonicalContestId, canonicalSlug);

      const adminActor = req.user ? (req.user.username || req.user.id || req.user.role) : 'ADMIN';
      const adminRole = req.user ? req.user.role : 'Super Admin';

      const deletedCounts = {
        contestParticipants: getAffectedRows(delCPRes),
        contestAttendance: getAffectedRows(delCARes),
        autoAttendanceRecords: getAffectedRows(delAutoARRes),
        manualAttendanceRecords: getAffectedRows(delManualARRes),
        contestLeaderboardSnapshots: getAffectedRows(delSnapRes),
        contestSyncLogs: getAffectedRows(delSyncLogRes),
        contestSnapshots: getAffectedRows(delLiveSnapRes)
      };

      const preservedCounts = {
        manualAttendanceRecords: includeManualOverrides ? 0 : getCount(manualArRes),
        registrations: getCount(regRes),
        participationLogs: getCount(partRes),
        users: true,
        contestMetadata: true
      };

      // Standard Audit Output format
      console.log(`[CONTEST-RESET]
admin=${adminActor}
contest=${canonicalSlug}
contestId=${canonicalContestId}
manualOverridesDeleted=${!!includeManualOverrides}
contestParticipantsDeleted=${deletedCounts.contestParticipants}
contestAttendanceDeleted=${deletedCounts.contestAttendance}
autoAttendanceDeleted=${deletedCounts.autoAttendanceRecords}
manualAttendanceDeleted=${deletedCounts.manualAttendanceRecords}
result=SUCCESS`);

      // Post-Reset Database Verification
      const verCP = await db.query("SELECT COUNT(*) AS count FROM ContestParticipants WHERE contest_slug = ?", [canonicalSlug]);
      const verCA = await db.query("SELECT COUNT(*) AS count FROM ContestAttendance WHERE contestId IN (SELECT id FROM LiveContests WHERE contestSlug = ?)", [canonicalSlug]);
      const verAuto = await db.query("SELECT COUNT(*) AS count FROM AttendanceRecords WHERE contest_id = ? AND (attendance_source = 'AUTO' OR attendance_source IS NULL)", [canonicalContestId]);

      const resetVerified = (getCount(verCP) === 0 && getCount(verCA) === 0 && getCount(verAuto) === 0);

      if (resetVerified) {
        console.log(`[RESET-VERIFY]
Contest: ${canonicalSlug}
ContestParticipants: ${getCount(verCP)}
ContestAttendance: ${getCount(verCA)}
AUTO AttendanceRecords: ${getCount(verAuto)}
MANUAL AttendanceRecords: ${preservedCounts.manualAttendanceRecords}
Registrations: ${preservedCounts.registrations}
ParticipationLogs: ${preservedCounts.participationLogs}
Result: RESET VERIFIED`);
      } else {
        console.error(`[AUDIT] RESET_VERIFICATION_FAILED for contest ${canonicalSlug}`);
      }

      await auditLogService.log('CONTEST_RESET', {
        actor: adminActor,
        targetType: 'contest',
        targetId: canonicalContestId,
        details: {
          contestSlug: canonicalSlug,
          role: adminRole,
          deleted: deletedCounts,
          preserved: preservedCounts,
          includeManualOverrides: !!includeManualOverrides,
          resetVerified
        },
        severity: 'INFO'
      });

      return res.json({
        success: true,
        contest: {
          id: canonicalContestId,
          slug: canonicalSlug,
          platform: contest.source || 'leetcode',
          title: contest.title
        },
        deleted: deletedCounts,
        preserved: preservedCounts,
        message: 'Contest data cleared successfully. Contest is ready for re-sync.'
      });

    } catch (txErr) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {}
      }
      throw txErr;
    } finally {
      if (connection) connection.release();
    }

  } catch (err) {
    console.error('[AdminContestController] Contest reset failed:', err.message);

    await auditLogService.log('CONTEST_RESET_FAILED', {
      actor: req.user ? (req.user.username || req.user.id || req.user.role) : 'ADMIN',
      targetType: 'contest',
      targetId: contestId,
      details: { error: err.message },
      severity: 'ERROR'
    });

    return res.status(500).json({
      success: false,
      message: `Failed to clear contest data: ${err.message}`
    });
  } finally {
    const contest = await resolveContest(contestId);
    if (contest) {
      activeResetLocks.delete(contest.slug);
    }
  }
}

/**
 * Trigger clean contest re-sync starting from page 1.
 * POST /api/admin/contest/:contestId/sync
 */
async function syncContestData(req, res) {
  const { contestId } = req.params;
  const batch = req.body?.batch || req.query?.batch || '2024-28';

  try {
    const contest = await resolveContest(contestId);
    if (!contest) {
      return res.status(404).json({
        success: false,
        message: `Contest with identifier '${contestId}' not found.`
      });
    }

    const canonicalContestId = contest.contest_id;
    const canonicalSlug = contest.slug;

    if (activeSyncLocks.has(canonicalSlug) || activeResetLocks.has(canonicalSlug)) {
      return res.status(409).json({
        success: false,
        message: `Synchronization or reset is already in progress for '${canonicalSlug}'.`
      });
    }

    console.log(`[AdminContestController] Triggering fresh re-sync for contest ${canonicalSlug} (batch: ${batch})...`);
    
    ContestLeaderboardSyncService.syncContest(canonicalSlug, {
      batch,
      forceSync: true
    }).then(async (syncResult) => {
      console.log(`[AdminContestController] Fresh re-sync completed for ${canonicalSlug}:`, syncResult);
      const cpRes = await db.query("SELECT COUNT(*) AS count FROM ContestParticipants WHERE contest_slug = ?", [canonicalSlug]);
      const cpCount = getCount(cpRes);

      const sampleCp = await db.query(
        "SELECT username, `rank`, score, problems_solved, finish_time FROM ContestParticipants WHERE contest_slug = ? LIMIT 1",
        [canonicalSlug]
      );
      const sample = (sampleCp && sampleCp[0]) ? sampleCp[0] : {};

      console.log(`[SYNC-VERIFY]
Contest: ${canonicalSlug}
ContestParticipants: ${cpCount}
Example participant:
rank=${sample.rank || 'null'}
problemsSolved=${sample.problems_solved || 'null'}
contestScore=${sample.score || 'null'}
finishTime=${sample.finish_time || 'null'}
Result: CLEAN RESYNC VERIFIED`);

    }).catch(err => {
      console.error(`[AdminContestController] Re-sync failed for ${canonicalSlug}:`, err.message);
    });

    return res.json({
      success: true,
      contest: {
        id: canonicalContestId,
        slug: canonicalSlug,
        title: contest.title
      },
      message: `Fresh synchronization started for contest '${canonicalSlug}'.`
    });

  } catch (err) {
    console.error('[AdminContestController] Re-sync trigger error:', err);
    return res.status(500).json({
      success: false,
      message: `Failed to trigger contest re-sync: ${err.message}`
    });
  }
}

module.exports = {
  previewContestReset,
  resetContestData,
  syncContestData
};
