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
  static async syncContestAttendance({ contestSlug, providerType, csvRecords = [], actor = 'SYSTEM', onProgress = null }) {
    const startTime = Date.now();
    console.log(`[StudentContestSyncService] [DIAGNOSTICS] ========== Student Contest Sync Start ==========`);
    console.log(`[StudentContestSyncService] [DIAGNOSTICS] Contest Slug Received: "${contestSlug}"`);
    console.log(`[StudentContestSyncService] [DIAGNOSTICS] Provider: "${providerType || process.env.SYNC_PROVIDER || 'HYBRID'}"`);

    // 1. Fetch active students from database
    const students = await db.query(
      "SELECT id, name, roll_no, leetcode_username, academic_batch, status FROM Users WHERE status = 'active'"
    );

    console.log(`[StudentContestSyncService] [DIAGNOSTICS] Active Students Count: ${students?.length || 0}`);

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

    // 2. Resolve contest ID from Contests & LiveContests tables (auto-create or heal start_time if missing/inaccurate)
    const { getLeetCodeOfficialStartTime } = require('../utils/contestLifecycle');
    let officialStartTime = getLeetCodeOfficialStartTime(contestSlug) || new Date();

    let realContestId = null;
    let liveContestId = null;
    let contestTitle = contestSlug;

    // A. Resolve Contests row (for AttendanceRecords.contest_id)
    const contestRows = await db.query("SELECT contest_id, title FROM Contests WHERE slug = ?", [contestSlug]);
    if (contestRows.length > 0) {
      realContestId = contestRows[0].contest_id;
      contestTitle = contestRows[0].title || contestSlug;
      if (getLeetCodeOfficialStartTime(contestSlug)) {
        await db.query("UPDATE Contests SET start_time = ? WHERE contest_id = ?", [officialStartTime, realContestId]);
      }
    } else {
      const formattedTitle = contestSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const res = await db.query(
        "INSERT INTO Contests (slug, title, start_time, contest_type, contest_status, source) VALUES (?, ?, ?, 'Weekly', 'Rated', 'ENTRANTHUB')",
        [contestSlug, formattedTitle, officialStartTime]
      );
      realContestId = res.insertId;
      contestTitle = formattedTitle;
    }

    // B. Resolve LiveContests row (for ContestAttendance.contestId)
    const liveRows = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [contestSlug]);
    const officialEndTime = new Date(officialStartTime.getTime() + 90 * 60 * 1000);
    if (liveRows.length > 0) {
      liveContestId = liveRows[0].id;
      if (getLeetCodeOfficialStartTime(contestSlug)) {
        await db.query("UPDATE LiveContests SET startTime = ?, endTime = ? WHERE id = ?", [officialStartTime, officialEndTime, liveContestId]);
      }
    } else {
      const liveRes = await db.query(
        `INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
         VALUES ('LeetCode', ?, ?, 'Weekly', ?, ?, 'Completed')`,
        [contestSlug, contestTitle, officialStartTime, officialEndTime]
      );
      liveContestId = liveRes.insertId;
    }

    console.log(`[StudentContestSyncService] [DIAGNOSTICS] Resolved Target Title: "${contestTitle}"`);
    console.log(`[StudentContestSyncService] [DIAGNOSTICS] Contests.contest_id: ${realContestId}`);
    console.log(`[StudentContestSyncService] [DIAGNOSTICS] LiveContests.id: ${liveContestId}`);

    // 3. Obtain provider instance & resolve attendance records with automatic CLIST fallback
    let provider = AttendanceProviderFactory.getProvider(providerType, { csvRecords });
    let resolvedItems = null;
    let providerFailed = false;

    // Collect registered student handles for early-exit optimization in CLIST fallback
    const registeredUsernames = students
      .map(s => normalizeUsername(s.leetcode_username))
      .filter(Boolean);

    try {
      resolvedItems = await provider.resolveAttendance({
        contestSlug,
        students,
        onProgress: typeof onProgress === 'function'
          ? (completed, total) => {
              const pct = total > 0 ? 15 + Math.round((completed / total) * 75) : 15;
              onProgress(pct, `Scanned ${completed}/${total} students...`);
            }
          : null
      });

      const scrapedCount = resolvedItems ? resolvedItems.scrapedParticipantCount : undefined;
      if (scrapedCount !== undefined && scrapedCount <= 0) {
        console.warn(`[StudentContestSyncService] Primary provider "${provider.providerName || providerType}" returned 0 participants. Triggering CLIST fallback...`);
        providerFailed = true;
      }
    } catch (primaryErr) {
      console.warn(`[StudentContestSyncService] Primary provider "${provider.providerName || providerType}" failed (${primaryErr.message}). Triggering CLIST fallback...`);
      providerFailed = true;
    }

    // Automated CLIST Fallback Orchestration
    let isClistFallback = false;
    if (providerFailed && providerType !== 'CLIST') {
      const ClistAdapterClass = require('./clist/ClistAdapter');
      const clistAdapter = new ClistAdapterClass();

      if (clistAdapter.isAvailable()) {
        console.log(`[StudentContestSyncService] Executing CLIST fallback for contest "${contestSlug}"...`);
        try {
          // Discover contest or search by event name / slug
          const ClistClient = require('./clist/ClistClient');
          const contestSearchRes = await ClistClient.getContests({
            resource: 'leetcode.com',
            search: contestSlug.replace(/-/g, ' ')
          }).catch(() => null);

          let clistContestId = contestSlug;
          if (contestSearchRes && contestSearchRes.objects && contestSearchRes.objects.length > 0) {
            const matchedContest = contestSearchRes.objects.find(c =>
              (c.key || '').toLowerCase() === contestSlug.toLowerCase() ||
              (c.event || '').toLowerCase() === contestSlug.replace(/-/g, ' ').toLowerCase()
            ) || contestSearchRes.objects[0];
            clistContestId = matchedContest.id;
          }

          const clistParticipants = await clistAdapter.getContestParticipants(clistContestId, {
            resource: 'leetcode.com',
            registeredUsernames
          });

          // Match CLIST participants against registered student roster
          const clistParticipantMap = new Map();
          for (const p of clistParticipants) {
            if (p.username) clistParticipantMap.set(p.username, p);
          }

          const isLeaderboardComplete = clistParticipants.leaderboardComplete === true;
          const isAttendanceVerified = clistParticipants.attendanceVerified === true;

          resolvedItems = students.map(student => {
            const normUser = normalizeUsername(student.leetcode_username);
            const participantData = normUser ? clistParticipantMap.get(normUser) : null;

            if (participantData && participantData.rank > 0) {
              return {
                studentId: student.id,
                username: student.leetcode_username,
                attended: true,
                status: 'PRESENT',
                rank: participantData.rank,
                score: participantData.score,
                problemsSolved: participantData.score > 0 ? Math.min(4, Math.floor(participantData.score / 3)) : 0,
                rating: null,
                source: 'CLIST',
                provider: 'CLIST',
                error: null
              };
            }

            // NEGATIVE EVIDENCE SAFETY RULE: Mark ABSENT ONLY if leaderboard is 100% complete
            const finalStatus = isLeaderboardComplete ? 'ABSENT' : 'UNKNOWN';
            return {
              studentId: student.id,
              username: student.leetcode_username,
              attended: false,
              status: finalStatus,
              rank: null,
              score: 0.00,
              problemsSolved: 0,
              rating: null,
              source: 'CLIST',
              provider: 'CLIST',
              error: isAttendanceVerified ? null : `CLIST data syncState=${clistParticipants.syncState}`
            };
          });

          resolvedItems.scrapedParticipantCount = clistParticipants.totalCount || clistParticipants.length;
          resolvedItems.leaderboardComplete = isLeaderboardComplete;
          resolvedItems.syncState = clistParticipants.syncState;
          provider = clistAdapter;
          isClistFallback = true;
          console.log(`[StudentContestSyncService] CLIST fallback succeeded. syncState="${clistParticipants.syncState}", leaderboardComplete=${isLeaderboardComplete}`);
        } catch (clistErr) {
          console.error(`[StudentContestSyncService] CLIST fallback failed: ${clistErr.message}`);
        }
      }
    }

    if (!resolvedItems) {
      await db.query(
        "UPDATE LiveContests SET status = 'Failed', lastSyncAt = NOW() WHERE id = ?",
        [liveContestId]
      ).catch(() => {});
      throw new Error(`Failed to resolve attendance for contest '${contestSlug}' across all providers (including CLIST fallback).`);
    }

    const scrapedCount = resolvedItems.scrapedParticipantCount;
    if (scrapedCount !== undefined && scrapedCount <= 0 && !isClistFallback) {
      await db.query(
        "UPDATE LiveContests SET status = 'Failed', totalParticipants = 0, lastSyncAt = NOW() WHERE id = ?",
        [liveContestId]
      ).catch(() => {});
      throw new Error(`Could not fetch contest rankings — verify contest slug '${contestSlug}' exists and has started/ended.`);
    }

    console.log(`[StudentContestSyncService] [DIAGNOSTICS] Provider Resolved Items Count: ${resolvedItems.length}`);

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

    console.log(`[StudentContestSyncService] [DIAGNOSTICS] Filtered Present Count: ${presentCount}`);
    console.log(`[StudentContestSyncService] [DIAGNOSTICS] Filtered Absent Count: ${absentCount}`);
    console.log(`[StudentContestSyncService] [DIAGNOSTICS] Filtered Blocked Count: ${blockedCount}`);

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

            // Upsert into ContestParticipants if Present
            if (finalStatus === 'PRESENT' && normHandle) {
              await conn.query(
                `INSERT INTO ContestParticipants (
                  contest_slug, username, \`rank\`, score, problems_solved, finish_time, page_number, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 1, NOW())
                ON DUPLICATE KEY UPDATE
                  \`rank\` = VALUES(\`rank\`),
                  score = VALUES(score),
                  problems_solved = VALUES(problems_solved),
                  finish_time = VALUES(finish_time),
                  updated_at = NOW()`,
                [
                  contestSlug, normHandle, item.rank || 0, item.score || 0.00, item.problemsSolved || 0, item.finishTime || 0
                ]
              ).catch(() => {}); // Non-fatal if ContestParticipants table schema differs
            }

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

    // Record persistent telemetry in ContestSyncLog, ContestSnapshots, LiveContests & AuditLog
    const scrapedParticipantCount = resolvedItems.scrapedParticipantCount || presentCount || 0;
    const pagesFetched = resolvedItems.pagesFetched || 1;
    const totalRequests = pagesFetched;
    const studentsProcessed = students.length;

    try {
      await db.query(
        `UPDATE LiveContests SET totalParticipants = ?, lastSyncAt = NOW(), status = 'Completed' WHERE id = ?`,
        [scrapedParticipantCount, liveContestId]
      );

      await db.query(
        `INSERT INTO ContestSyncLog (contestId, started_at, completed_at, total_requests, failed_requests, retry_count, syncStarted, participantsFetched, pagesFetched)
         VALUES (?, FROM_UNIXTIME(? / 1000), NOW(), ?, ?, 0, FROM_UNIXTIME(? / 1000), ?, ?)`,
        [liveContestId, startTime, totalRequests, blockedCount, startTime, scrapedParticipantCount, pagesFetched]
      ).catch(() => {
        // Fallback for variation in ContestSyncLog column names
        return db.query(
          `INSERT INTO ContestSyncLog (contestId, syncStarted, syncCompleted, pagesFetched, participantsFetched)
           VALUES (?, FROM_UNIXTIME(? / 1000), NOW(), ?, ?)`,
          [liveContestId, startTime, pagesFetched, scrapedParticipantCount]
        );
      });

      const attPct = studentsProcessed > 0 ? Number(((presentCount / studentsProcessed) * 100).toFixed(2)) : 0.00;
      await db.query(
        `INSERT INTO ContestSnapshots (contestId, participants, attendancePercentage, snapshotTime)
         VALUES (?, ?, ?, NOW())`,
        [liveContestId, presentCount, attPct]
      ).catch(() => {});

      await db.query(
        `INSERT INTO AuditLog (action, actor, target_type, target_id, details, severity, result, duration_ms, source_platform)
         VALUES ('CONTEST_STUDENT_SYNC', ?, 'CONTEST', ?, ?, 'INFO', ?, ?, ?)`,
        [
          actor,
          contestSlug,
          JSON.stringify({ processed: studentsProcessed, scrapedParticipants: scrapedParticipantCount, presentCount, absentCount, unknownCount, blockedCount }),
          blockedCount > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
          Date.now() - startTime,
          provider.providerName
        ]
      );
    } catch (logErr) {
      console.warn(`[StudentContestSyncService] Telemetry update skipped:`, logErr.message);
    }

    const overallSyncStatus = blockedCount > 0 ? 'PARTIAL_SYNC' : 'COMPLETED';

    console.log(`[StudentContestSyncService] [DIAGNOSTICS] ========== Student Contest Sync Complete ==========`);
    console.log(`[StudentContestSyncService] [DIAGNOSTICS] Students Processed: ${studentsProcessed}, Scraped Participants: ${scrapedParticipantCount}, Present: ${presentCount}, Absent: ${absentCount}, LiveContestId: ${liveContestId}, RealContestId: ${realContestId}`);

    return {
      success: true,
      contestSlug,
      contestId: realContestId,
      liveContestId,
      provider: provider.providerName,
      syncStatus: overallSyncStatus,
      studentsProcessed: studentsProcessed,
      processedStudents: studentsProcessed,
      totalParticipants: scrapedParticipantCount,
      scrapedParticipantCount: scrapedParticipantCount,
      presentCount,
      absentCount,
      unknownCount,
      blockedCount,
      durationMs: Date.now() - startTime
    };
  }
}

module.exports = StudentContestSyncService;
