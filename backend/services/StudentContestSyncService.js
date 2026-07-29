const db = require('../config/db');
const AttendanceProviderFactory = require('./providers/AttendanceProviderFactory');
const { normalizeUsername } = require('../utils/usernameNormalizer');

class StudentContestSyncService {
  /**
   * Synchronize contest attendance for all active students.
   * @param {object} options
   * @param {string} options.contestSlug - Contest slug to sync (e.g. 'weekly-contest-400')
   * @param {string} [options.providerType] - Optional provider override ('GRAPHQL', 'CSV', 'LEGACY', 'HYBRID')
   * @param {Array<object>} [options.csvRecords] - Optional CSV records for CSV provider
   * @param {string} [options.actor] - Initiator of the sync job (default 'SYSTEM')
   * @returns {Promise<object>} - Telemetry & sync summary report
   */
  static async syncContestAttendance({ contestSlug, providerType, csvRecords = [], actor = 'SYSTEM' }) {
    const startTime = Date.now();
    console.log(`[StudentContestSyncService] Initiating sync for contest "${contestSlug}" using provider "${providerType || process.env.SYNC_PROVIDER || 'HYBRID'}"...`);

    // 1. Fetch active students from database
    const students = await db.query(
      "SELECT id, name, roll_no, leetcode_username, academic_batch, status FROM Users WHERE status = 'active'"
    );

    if (!students || students.length === 0) {
      console.warn('[StudentContestSyncService] No active students found in database.');
      return {
        success: true,
        contestSlug,
        processedStudents: 0,
        presentCount: 0,
        absentCount: 0,
        unknownCount: 0,
        blockedCount: 0,
        durationMs: Date.now() - startTime
      };
    }

    // 2. Resolve contest ID from Contests & LiveContests tables (auto-create if missing)
    let realContestId = null;
    let liveContestId = null;
    let contestTitle = contestSlug;

    // A. Resolve Contests row (for AttendanceRecords.contest_id)
    const contestRows = await db.query("SELECT contest_id, title FROM Contests WHERE slug = ?", [contestSlug]);
    if (contestRows.length > 0) {
      realContestId = contestRows[0].contest_id;
      contestTitle = contestRows[0].title || contestSlug;
    } else {
      const formattedTitle = contestSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const res = await db.query(
        "INSERT INTO Contests (slug, title, start_time, contest_type, contest_status, source) VALUES (?, ?, NOW(), 'Weekly', 'Rated', 'ENTRANTHUB')",
        [contestSlug, formattedTitle]
      );
      realContestId = res.insertId;
      contestTitle = formattedTitle;
    }

    // B. Resolve LiveContests row (for ContestAttendance.contestId)
    const liveRows = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [contestSlug]);
    if (liveRows.length > 0) {
      liveContestId = liveRows[0].id;
    } else {
      const liveRes = await db.query(
        `INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
         VALUES ('LeetCode', ?, ?, 'Weekly', NOW(), DATE_ADD(NOW(), INTERVAL 90 MINUTE), 'Completed')`,
        [contestSlug, contestTitle]
      );
      liveContestId = liveRes.insertId;
    }

    // 3. Obtain provider instance & resolve attendance records
    const provider = AttendanceProviderFactory.getProvider(providerType, { csvRecords });
    const resolvedItems = await provider.resolveAttendance({ contestSlug, students });

    // 4. Fetch existing database attendance records to enforce Downgrade Protection Guard
    const existingCaRows = await db.query(
      "SELECT studentId, attendanceStatus FROM ContestAttendance WHERE contestId = ?",
      [liveContestId]
    );
    const existingCaMap = new Map(existingCaRows.map(r => [r.studentId, r.attendanceStatus]));

    const existingArRows = await db.query(
      "SELECT user_id, attendance_status FROM AttendanceRecords WHERE contest_id = ?",
      [realContestId]
    );
    const existingArMap = new Map(existingArRows.map(r => [r.user_id, r.attendance_status]));

    let presentCount = 0;
    let absentCount = 0;
    let unknownCount = 0;
    let blockedCount = 0;
    const processedItems = [];

    // 5. Apply State Machine & Downgrade Protection
    for (const item of resolvedItems) {
      const studentId = item.studentId;
      let finalStatus = item.status;

      const prevCaStatus = existingCaMap.get(studentId);
      const prevArStatus = existingArMap.get(studentId);
      const isPreviouslyPresent = prevCaStatus === 'Present' || prevCaStatus === 'PRESENT' || prevArStatus === 'PRESENT';

      // STRICT DOWNGRADE PROTECTION: PRESENT records are NEVER overwritten by ABSENT, UNKNOWN, or BLOCKED_UPSTREAM
      if (isPreviouslyPresent && finalStatus !== 'PRESENT') {
        console.log(`[Downgrade Protection] Preserving PRESENT status for studentId=${studentId} (${item.username})`);
        finalStatus = 'PRESENT';
        item.attended = true;
      }

      // State counters
      if (finalStatus === 'PRESENT') presentCount++;
      else if (finalStatus === 'ABSENT') absentCount++;
      else if (finalStatus === 'UNKNOWN') unknownCount++;
      else if (finalStatus === 'BLOCKED_UPSTREAM') blockedCount++;

      processedItems.push({
        ...item,
        finalStatus
      });
    }

    // 6. Execute atomic database upserts in progressive batches of 50 with automatic deadlock retry
    const pool = db.getPool();
    const BATCH_SIZE = 50;
    const MAX_DEADLOCK_RETRIES = 3;

    for (let i = 0; i < processedItems.length; i += BATCH_SIZE) {
      const batch = processedItems.slice(i, i + BATCH_SIZE);
      let attempt = 0;
      let batchSuccess = false;

      while (attempt < MAX_DEADLOCK_RETRIES && !batchSuccess) {
        attempt++;
        const conn = await pool.getConnection();

        try {
          await conn.beginTransaction();

          for (const item of batch) {
            const studentId = item.studentId;
            const normHandle = normalizeUsername(item.username) || item.username || '';
            const finalStatus = item.finalStatus;
            const caStatus = finalStatus === 'PRESENT' ? 'Present' : (finalStatus === 'ABSENT' ? 'Absent' : 'Unknown');
            const arStatus = finalStatus === 'PRESENT' ? 'PRESENT' : 'ABSENT';

            // Upsert into ContestAttendance
            await conn.query(
              `INSERT INTO ContestAttendance (
                contestId, studentId, username, attendanceStatus, \`rank\`, solved, score,
                ratingBefore, ratingAfter, ratingChange, syncProvider, attendanceSource,
                verificationMethod, syncStatus, upstreamError, firstDetectedAt, lastUpdatedAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
              ON DUPLICATE KEY UPDATE
                username = VALUES(username),
                attendanceStatus = VALUES(attendanceStatus),
                \`rank\` = COALESCE(VALUES(\`rank\`), \`rank\`),
                solved = GREATEST(VALUES(solved), solved),
                score = GREATEST(VALUES(score), score),
                ratingAfter = COALESCE(VALUES(ratingAfter), ratingAfter),
                ratingChange = COALESCE(VALUES(ratingChange), ratingChange),
                syncProvider = VALUES(syncProvider),
                attendanceSource = VALUES(attendanceSource),
                verificationMethod = VALUES(verificationMethod),
                syncStatus = VALUES(syncStatus),
                upstreamError = VALUES(upstreamError),
                lastUpdatedAt = NOW()`,
              [
                liveContestId, studentId, normHandle, caStatus, item.rank, item.problemsSolved, item.score,
                null, item.rating, item.ratingChange, provider.providerName, item.source,
                item.provider === 'GRAPHQL' ? 'GRAPHQL_HISTORY' : 'MANUAL',
                'COMPLETED', item.error || null
              ]
            );

            // Upsert into AttendanceRecords
            await conn.query(
              `INSERT INTO AttendanceRecords (
                user_id, contest_id, contest_name, contest_slug, contest_date, contest_status,
                attendance_status, attendance_source, sync_provider, verification_method,
                sync_status, upstream_error, \`rank\`, score, participated, last_updated
              ) VALUES (?, ?, ?, ?, NOW(), 'Rated', ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, NOW())
              ON DUPLICATE KEY UPDATE
                attendance_status = VALUES(attendance_status),
                attendance_source = VALUES(attendance_source),
                sync_provider = VALUES(sync_provider),
                verification_method = VALUES(verification_method),
                sync_status = VALUES(sync_status),
                upstream_error = VALUES(upstream_error),
                \`rank\` = COALESCE(VALUES(\`rank\`), \`rank\`),
                score = GREATEST(VALUES(score), score),
                participated = VALUES(participated),
                last_updated = NOW()`,
              [
                studentId, realContestId, contestTitle, contestSlug, arStatus, item.source,
                provider.providerName, item.provider === 'GRAPHQL' ? 'GRAPHQL_HISTORY' : 'MANUAL',
                item.error || null, item.rank, item.score, item.attended ? 1 : 0
              ]
            );

            // Update LeetCodeProfiles if rating/stats available
            if (item.rating) {
              await conn.query(
                `INSERT INTO LeetCodeProfiles (user_id, current_rating, highest_rating, last_synced)
                 VALUES (?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                   current_rating = VALUES(current_rating),
                   highest_rating = GREATEST(highest_rating, VALUES(current_rating)),
                   last_synced = NOW()`,
                [studentId, item.rating, item.rating]
              );
            }
          }

          await conn.commit();
          batchSuccess = true;
        } catch (err) {
          await conn.rollback();
          const isDeadlock = err.code === 'ER_LOCK_DEADLOCK' || err.errno === 1213 || err.code === 'ER_LOCK_WAIT_TIMEOUT';
          
          if (isDeadlock && attempt < MAX_DEADLOCK_RETRIES) {
            const jitterMs = Math.floor(Math.random() * 200) + 100 * attempt;
            console.warn(`[StudentContestSyncService] Deadlock detected on batch ${i}-${i + BATCH_SIZE} (Attempt ${attempt}/${MAX_DEADLOCK_RETRIES}). Retrying in ${jitterMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, jitterMs));
          } else {
            console.error(`[StudentContestSyncService] Database batch insert error (${i}-${i + BATCH_SIZE}) after attempt ${attempt}:`, err.message);
            break;
          }
        } finally {
          conn.release();
        }
      }
    }

    // Record persistent telemetry in ContestSyncLog & LiveContests
    try {
      await db.query(
        `UPDATE LiveContests SET totalParticipants = ?, lastSyncAt = NOW(), status = 'Completed' WHERE id = ?`,
        [processedItems.length, liveContestId]
      );

      await db.query(
        `INSERT INTO ContestSyncLog (contestId, started_at, completed_at, total_requests, failed_requests, retry_count)
         VALUES (?, FROM_UNIXTIME(? / 1000), NOW(), ?, ?, 0)`,
        [liveContestId, startTime, processedItems.length, blockedCount]
      );

      await db.query(
        `INSERT INTO AuditLog (action, actor, target_type, target_id, details, severity, result, duration_ms, source_platform)
         VALUES ('CONTEST_STUDENT_SYNC', ?, 'CONTEST', ?, ?, 'INFO', ?, ?, ?)`,
        [
          actor,
          contestSlug,
          JSON.stringify({ processed: students.length, presentCount, absentCount, unknownCount, blockedCount }),
          blockedCount > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
          Date.now() - startTime,
          provider.providerName
        ]
      );
    } catch (logErr) {
      console.warn(`[StudentContestSyncService] ContestSyncLog telemetry update skipped:`, logErr.message);
    }

    const overallSyncStatus = blockedCount > 0 ? 'PARTIAL_SYNC' : 'COMPLETED';

    return {
      success: true,
      contestSlug,
      contestId: realContestId,
      liveContestId,
      provider: provider.providerName,
      syncStatus: overallSyncStatus,
      processedStudents: students.length,
      presentCount,
      absentCount,
      unknownCount,
      blockedCount,
      durationMs: Date.now() - startTime
    };
  }
}

module.exports = StudentContestSyncService;
