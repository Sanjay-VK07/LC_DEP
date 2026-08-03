const db = require('../config/db');
const SyncLockManager = require('./syncLockManager');
const snapshotEngine = require('./snapshotEngine');

/**
 * Recovery engine (Singleton) invoked on server startup to handle interrupted synchronizations.
 */
class StartupRecovery {
  async run() {
    console.log('[StartupRecovery] Running startup checks for interrupted contest syncs...');

    // 0. Contest Integrity Self-Healing: Clean obsolete test orphans & recreate missing Contests entries
    try {
      console.log('[StartupRecovery] Running Contest Integrity self-healing checks...');
      
      // A. Remove test-only orphan LiveContests records (no matching Contests and no child ContestAttendance)
      const deletedTestOrphans = await db.query(`
        DELETE lc FROM LiveContests lc
        LEFT JOIN Contests c ON lc.contestSlug = c.slug
        LEFT JOIN ContestAttendance ca ON lc.id = ca.contestId
        WHERE c.slug IS NULL
          AND ca.id IS NULL
          AND (
            lc.contestSlug LIKE 'test-%' OR
            lc.contestSlug LIKE 'mock-%' OR
            lc.contestSlug LIKE 'dummy-%' OR
            lc.contestSlug LIKE 'upcoming-live-%' OR
            lc.is_test = 1
          )
      `);
      if (deletedTestOrphans.affectedRows > 0) {
        console.log(`[StartupRecovery] Purged ${deletedTestOrphans.affectedRows} obsolete test orphan LiveContests records.`);
      }

      // B. Auto-recreate missing Contests records for any remaining legitimate orphan LiveContests
      const orphanLive = await db.query(`
        SELECT lc.* FROM LiveContests lc
        LEFT JOIN Contests c ON lc.contestSlug = c.slug
        WHERE c.slug IS NULL
      `);

      for (const lc of orphanLive) {
        const slug = lc.contestSlug;
        const title = lc.contestName || slug;
        const contestType = lc.contestType || (slug.includes('biweekly') ? 'Biweekly' : 'Weekly');
        const match = slug.match(/contest-(\d+)/i) || slug.match(/starters-(\d+)/i) || slug.match(/(\d+)/);
        const contestNumber = match ? parseInt(match[1], 10) : 0;
        const startTime = lc.startTime ? new Date(lc.startTime) : new Date();
        const platform = lc.platform || 'LeetCode';

        await db.query(`
          INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
          VALUES (?, ?, ?, ?, ?, 5400, 'Rated', ?, 'SELF_HEALING')
          ON DUPLICATE KEY UPDATE title = VALUES(title), start_time = VALUES(start_time)
        `, [title, slug, contestType, contestNumber, startTime, platform]);
        console.log(`[StartupRecovery] Auto-recreated missing Contests record for orphan LiveContests slug: "${slug}"`);
      }
    } catch (integrityErr) {
      console.warn('[StartupRecovery] Contest Integrity self-healing error (non-critical):', integrityErr.message);
    }
    
    // 1. Data Recovery check for incorrect ABSENT statuses (unconditional)
    try {
      console.log('[StartupRecovery] Running database-wide recovery check for incorrect ABSENT statuses...');

      const connection = await db.getPool().getConnection();
      try {
        await connection.beginTransaction();

        // A. Find and update ContestAttendance (status ABSENT -> PRESENT) if verified data exists
        const caUpdateResult = await connection.query(`
          UPDATE ContestAttendance
          SET attendanceStatus = 'PRESENT'
          WHERE attendanceStatus = 'ABSENT'
            AND (\`rank\` IS NOT NULL OR score > 0.00 OR penalty > 0)
        `);

        // B. Find and update AttendanceRecords (status ABSENT -> PRESENT) if verified data exists
        const arUpdateResult = await connection.query(`
          UPDATE AttendanceRecords
          SET attendance_status = 'PRESENT',
              remarks = COALESCE(remarks, 'Present via Startup Recovery')
          WHERE attendance_status = 'ABSENT'
            AND (\`rank\` IS NOT NULL OR score > 0.00)
        `);

        // C. Sync ContestAttendance Present to AttendanceRecords PRESENT (ABSENT -> PRESENT only)
        const arSyncResult = await connection.query(`
          UPDATE AttendanceRecords ar
          JOIN Contests c ON ar.contest_id = c.contest_id
          JOIN LiveContests lc ON c.slug = lc.contestSlug
          JOIN ContestAttendance ca ON lc.id = ca.contestId AND ar.user_id = ca.studentId
          SET ar.attendance_status = 'PRESENT',
              ar.\`rank\` = COALESCE(ar.\`rank\`, ca.\`rank\`),
              ar.score = COALESCE(ar.score, ca.score),
              ar.problems_solved = COALESCE(ar.problems_solved, ca.solved),
              ar.remarks = COALESCE(ar.remarks, 'Present via Startup Recovery')
          WHERE ca.attendanceStatus = 'PRESENT'
            AND ar.attendance_status = 'ABSENT'
        `);

        // D. Sync AttendanceRecords PRESENT to ContestAttendance Present (Absent -> Present only)
        const caSyncResult = await connection.query(`
          UPDATE ContestAttendance ca
          JOIN LiveContests lc ON ca.contestId = lc.id
          JOIN Contests c ON lc.contestSlug = c.slug
          JOIN AttendanceRecords ar ON c.contest_id = ar.contest_id AND ca.studentId = ar.user_id
          SET ca.attendanceStatus = 'PRESENT',
              ca.\`rank\` = COALESCE(ca.\`rank\`, ar.\`rank\`),
              ca.score = COALESCE(ca.score, ar.score),
              ca.solved = COALESCE(ca.solved, ar.problems_solved)
          WHERE ar.attendance_status = 'PRESENT'
            AND ca.attendanceStatus = 'ABSENT'
            AND (ar.\`rank\` IS NOT NULL OR ar.score > 0.00)
        `);

        // E. Sync ContestParticipants entries to both tables to restore PRESENT status
        const cpSyncCaResult = await connection.query(`
          UPDATE ContestAttendance ca
          JOIN LiveContests lc ON ca.contestId = lc.id
          JOIN Users u ON ca.studentId = u.id
          JOIN ContestParticipants cp ON lc.contestSlug = cp.contest_slug AND u.leetcode_username = cp.username
          SET ca.attendanceStatus = 'PRESENT',
              ca.\`rank\` = COALESCE(ca.\`rank\`, cp.\`rank\`),
              ca.score = COALESCE(ca.score, cp.score),
              ca.solved = COALESCE(ca.solved, cp.problems_solved)
          WHERE ca.attendanceStatus = 'ABSENT'
        `);

        const cpSyncArResult = await connection.query(`
          UPDATE AttendanceRecords ar
          JOIN Contests c ON ar.contest_id = c.contest_id
          JOIN Users u ON ar.user_id = u.id
          JOIN ContestParticipants cp ON c.slug = cp.contest_slug AND u.leetcode_username = cp.username
          SET ar.attendance_status = 'PRESENT',
              ar.\`rank\` = COALESCE(ar.\`rank\`, cp.\`rank\`),
              ar.score = COALESCE(ar.score, cp.score),
              ar.problems_solved = COALESCE(ar.problems_solved, cp.problems_solved),
              ar.remarks = COALESCE(ar.remarks, 'Present via Startup Recovery')
          WHERE ar.attendance_status = 'ABSENT'
        `);

        await connection.commit();

        const recoveredCount = (caUpdateResult.affectedRows || 0) + (arUpdateResult.affectedRows || 0) + 
                               (arSyncResult.affectedRows || 0) + (caSyncResult.affectedRows || 0) +
                               (cpSyncCaResult.affectedRows || 0) + (cpSyncArResult.affectedRows || 0);

        if (recoveredCount > 0) {
          console.log(`[StartupRecovery] Recovered/Consistent records count: ${recoveredCount}`);
        } else {
          console.log('[StartupRecovery] No incorrect ABSENT records to recover.');
        }
      } catch (txErr) {
        await connection.rollback();
        console.error('[StartupRecovery] Failed database recovery transaction:', txErr.message);
      } finally {
        connection.release();
      }
    } catch (recoveryErr) {
      console.error('[StartupRecovery] Error during incorrect ABSENT status recovery:', recoveryErr.message);
    }

    // 2. Interrupted contest sync recovery
    try {
      const activeContests = await db.query(
        "SELECT * FROM LiveContests WHERE status IN ('Live', 'Synchronizing')"
      );

      if (activeContests.length === 0) {
        console.log('[StartupRecovery] No interrupted live contests found on boot.');
        return;
      }

      const now = new Date();

      for (const contest of activeContests) {
        const endTime = new Date(contest.endTime);

        if (now > endTime) {
          console.log(`[StartupRecovery] Finalizing contest "${contest.contestName}" (ID: ${contest.id}) which ended while server was down.`);

          // Release locks
          SyncLockManager.release('Idle');

          // Transition status to Completed
          await db.query("UPDATE LiveContests SET status = 'Completed', lastSyncAt = NOW() WHERE id = ?", [contest.id]);

          // Load active students and database snapshot
          const students = await db.query("SELECT id, leetcode_username FROM Users WHERE status = 'active'");
          await snapshotEngine.loadSnapshot(contest.id);

          for (const s of students) {
            const prev = snapshotEngine.previousSnapshots[contest.id] || {};
            const old = prev[s.id];

            let finalStatus = 'Absent';
            let solved = 0;
            let score = 0;
            let rank = null;
            let penalty = 0;
            let ratingBefore = null;

            // If detected as participating during the contest, mark as Present
            if (old && (old.attendanceStatus === 'Participating' || old.attendanceStatus === 'Present')) {
              finalStatus = 'Present';
              solved = old.solved;
              score = old.score;
              rank = old.rank;
              penalty = old.penalty;
              ratingBefore = old.ratingBefore;
            }

            await snapshotEngine.compareAndUpdate(contest.id, s.id, s.leetcode_username, {
              attendanceStatus: finalStatus,
              rank,
              solved,
              score,
              penalty,
              ratingBefore
            });
          }

          // Generate final snapshot aggregates
          await snapshotEngine.recordContestSnapshot(contest.id);
          console.log(`[StartupRecovery] Finalized and recorded stats for recovered contest ID: ${contest.id}`);
        } else {
          console.log(`[StartupRecovery] Contest "${contest.contestName}" (ID: ${contest.id}) is still live. Resetting sync locks so scheduler loops can execute.`);
          SyncLockManager.release('Idle');
        }
      }
    } catch (err) {
      console.error('[StartupRecovery] Error during startup recovery execution:', err.message);
    }
  }
}

module.exports = new StartupRecovery();
