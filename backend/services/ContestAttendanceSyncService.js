const db = require('../config/db');
const { getAdapter } = require('./adapters/AdapterFactory');
const cache = require('./analyticsCacheService');
const { normalizeUsername } = require('../utils/usernameNormalizer');

class ContestAttendanceSyncService {
  /**
   * Run background attendance sync for a contest.
   * @param {string|number} contestId - ID or slug of the contest
   * @param {object} options - Options including jobId, updateProgress callback, and sync pass number
   */
  static async syncContestAttendance(contestId, options = {}) {
    const jobId = options.jobId || null;
    const updateProgress = options.updateProgress || (() => {});
    const pass = typeof options.pass === 'number' ? options.pass : 0;
    const syncStartTime = Date.now();

    updateProgress(5, 'Starting unified attendance synchronization...');

    // 1. Resolve contest details from DB
    let contestRows = [];
    let liveContest = null;

    if (typeof contestId === 'number' || !isNaN(Number(contestId))) {
      const rows = await db.query("SELECT * FROM LiveContests WHERE id = ?", [contestId]);
      if (rows.length > 0) {
        liveContest = rows[0];
        contestRows = await db.query(
          "SELECT contest_id, platform, title, start_time, slug, contest_status, duration, contest_type FROM Contests WHERE slug = ?",
          [liveContest.contestSlug]
        );
      }
    } else {
      const rows = await db.query("SELECT * FROM LiveContests WHERE contestSlug = ?", [contestId]);
      if (rows.length > 0) {
        liveContest = rows[0];
      }
      contestRows = await db.query(
        "SELECT contest_id, platform, title, start_time, slug, contest_status, duration, contest_type FROM Contests WHERE slug = ?",
        [contestId]
      );
    }

    if (contestRows.length === 0 && !liveContest) {
      contestRows = await db.query(
        "SELECT contest_id, platform, title, start_time, slug, contest_status, duration, contest_type FROM Contests WHERE contest_id = ? OR slug = ?",
        [contestId, contestId]
      );
    }

    if (contestRows.length === 0 && !liveContest) {
      throw new Error(`Contest "${contestId}" not found in database.`);
    }

    let contest = contestRows[0];
    let realContestId;
    let platform;
    let slug;

    if (contest) {
      realContestId = contest.contest_id;
      platform = contest.platform || 'LeetCode';
      slug = contest.slug;
    } else {
      realContestId = liveContest.id;
      platform = liveContest.platform || 'LeetCode';
      slug = liveContest.contestSlug;
      contest = {
        contest_id: liveContest.id,
        platform: liveContest.platform,
        title: liveContest.contestName,
        start_time: liveContest.startTime,
        slug: liveContest.contestSlug,
        contest_status: 'RATED',
        duration: Math.round((new Date(liveContest.endTime) - new Date(liveContest.startTime)) / 1000)
      };
    }

    console.log(`[Sync Worker] [DIAGNOSTICS] ========== Attendance Sync Start ==========`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Contest Slug: "${slug}"`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Platform: ${platform}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Sync Pass: ${pass}`);

    updateProgress(15, `Resolved contest: ${contest.title} (${platform})`);

    // 2. Select Platform Adapter
    const adapter = getAdapter(platform);

    // 3. Fetch Contest Participants (with up to 3 retries)
    updateProgress(30, 'Retrieving participants from platform adapter...');
    let participants = [];
    let fetchSuccess = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        participants = await adapter.getContestParticipants(slug);
        fetchSuccess = true;
        break;
      } catch (err) {
        lastError = err;
        console.warn(`[Sync Worker] Attempt ${attempt} failed to fetch participants for ${platform} contest "${slug}": ${err.message}`);
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
      }
    }

    // Build participant lookup map with normalized usernames
    const participantMap = new Map();
    if (fetchSuccess) {
      participants.forEach(p => {
        if (p.username) {
          const normKey = normalizeUsername(p.username);
          if (normKey) {
            participantMap.set(normKey, p);
          }
        }
      });
      console.log(`[Sync Worker] [DIAGNOSTICS] Participants Fetched: ${participants.length}`);
      console.log(`[Sync Worker] [DIAGNOSTICS] Unique Normalized Entries: ${participantMap.size}`);
      updateProgress(60, `Successfully retrieved ${participants.length} participants from ${platform}.`);
    } else {
      console.error(`[Sync Worker] Failed to fetch participants for contest ${realContestId} on platform ${platform}:`, lastError.message);
      // Log the failure to DB sync logs
      await db.query(
        "INSERT INTO sync_logs (status, message, started_at, completed_at) VALUES ('failed', ?, NOW(), NOW())",
        [`Sync failed for contest ID ${realContestId} on ${platform}: ${lastError.message}`]
      ).catch(err => console.error('[Sync Worker] Failed to log failure to DB:', err.message));

      updateProgress(100, `Synchronization aborted: failed to fetch participants (${lastError.message}).`);
      return 'SYNC_FAILED';
    }

    // Zero Participant Protection
    if (fetchSuccess && participants.length === 0) {
      console.warn(`[Sync Worker] [WARNING] Official participant provider returned zero participants for contest "${slug}". Aborting sync to prevent marking everyone absent.`);
      updateProgress(100, 'Synchronization aborted: 0 participants returned.');
      return 'SYNC_SKIPPED';
    }

    // 4. Fetch all active students
    const students = await db.query(
      "SELECT id, name, leetcode_username, codeforces_username, codechef_username, hackerrank_username FROM Users WHERE status = 'active'"
    );

    console.log(`[Sync Worker] [DIAGNOSTICS] Students to Check: ${students.length}`);
    updateProgress(75, `Generating attendance mapping for ${students.length} students...`);

    // Resolve or insert LiveContests record
    let liveContestId = null;
    const liveRows = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
    if (liveRows.length > 0) {
      liveContestId = liveRows[0].id;
    } else {
      const duration = contest.duration || 5400;
      const endTime = new Date(new Date(contest.start_time).getTime() + duration * 1000);
      const liveIns = await db.query(`
        INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
        VALUES (?, ?, ?, ?, ?, ?, 'Completed')
      `, [platform, slug, contest.title, contest.contest_type || 'Weekly', contest.start_time, endTime]);
      liveContestId = liveIns.insertId || liveIns[0]?.insertId;
    }

    const connection = await db.getPool().getConnection();
    let matchedCount = 0;
    let absentCount = 0;
    let unknownCount = 0;
    let skippedDowngradeCount = 0;

    try {
      await connection.beginTransaction();

      for (const student of students) {
        const platLower = platform.toLowerCase();
        const handle = student[`${platLower}_username`];

        let status = 'Unknown';
        let rank = null;
        let score = 0.00;
        let penalty = 0;
        let solved = 0;
        let ratingBefore = null;

        if (!handle || !handle.trim()) {
          // No handle configured -> ABSENT
          status = 'Absent';
          absentCount++;
        } else if (!fetchSuccess) {
          // Successful fetch was not completed -> UNKNOWN
          status = 'Unknown';
          unknownCount++;
        } else {
          // Look up handle in participants map using normalized username
          const cleanHandle = normalizeUsername(handle);
          const match = participantMap.get(cleanHandle);
          if (match) {
            status = 'Present';
            rank = match.rank;
            score = match.score || 0.00;
            penalty = match.finishTime || 0;
            solved = match.problemsSolved || 0;
            matchedCount++;
          } else {
            status = 'Absent';
            absentCount++;
          }
        }

        // Fetch rating before sync if Present
        if (status === 'Present') {
          const profileTable = platform === 'LeetCode' ? 'LeetCodeProfiles' :
                               platform === 'CodeChef' ? 'CodeChefProfiles' :
                               platform === 'Codeforces' ? 'CodeforcesProfiles' : null;
          if (profileTable) {
            const [rRows] = await connection.query(`SELECT current_rating FROM ${profileTable} WHERE user_id = ?`, [student.id]);
            ratingBefore = rRows[0]?.current_rating ?? null;
          }
        }

        // -----------------------------------------------------------------
        // PROTECTION: Never downgrade Present → Absent/Unknown
        // If a previous higher-fidelity sync pass marked this student as
        // Present, do NOT overwrite with a lower-fidelity result.
        // -----------------------------------------------------------------
        const [existingRecord] = await connection.query(
          "SELECT attendanceStatus, syncPass, verified FROM ContestAttendance WHERE contestId = ? AND studentId = ?",
          [liveContestId, student.id]
        );

        let existingIsPresent = false;
        let existingIsVerified = false;
        let existingHigherPass = false;

        if (existingRecord.length > 0) {
          const existing = existingRecord[0];
          existingIsPresent = existing.attendanceStatus === 'Present' || existing.attendanceStatus === 'Participating';
          existingIsVerified = existing.verified === 1;
          existingHigherPass = existing.syncPass > pass;
        }

        if (existingIsPresent) {
          // Unknown must never overwrite Present
          if (status === 'Unknown') {
            skippedDowngradeCount++;
            continue; // Skip — preserve the existing Present status
          }
          // If existing record is Present (from a verified or higher-pass sync),
          // and the new status is Absent, skip this update.
          if (status === 'Absent' && (existingIsVerified || existingHigherPass)) {
            skippedDowngradeCount++;
            continue; // Skip — preserve the existing Present status
          }
        }

        // A. Insert/Update in ContestAttendance
        await connection.query(`
          INSERT INTO ContestAttendance (
            contestId, studentId, username, attendanceStatus, \`rank\`, solved, score, penalty, 
            ratingBefore, verified, syncPass, firstDetectedAt
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            attendanceStatus = VALUES(attendanceStatus),
            \`rank\` = VALUES(\`rank\`),
            solved = VALUES(solved),
            score = VALUES(score),
            penalty = VALUES(penalty),
            ratingBefore = VALUES(ratingBefore),
            verified = VALUES(verified),
            syncPass = VALUES(syncPass)
        `, [
          liveContestId,
          student.id,
          handle || '',
          status,
          rank,
          status === 'Present' ? solved : 0,
          score,
          penalty,
          ratingBefore,
          pass === 4 ? 1 : 0,
          pass
        ]);

        // B. Insert/Update in AttendanceRecords (legacy dashboard table) if status is not Unknown
        if (status !== 'Unknown') {
          const legacyStatus = status === 'Present' ? 'PRESENT' : 'ABSENT';
          const remarks = status === 'Present' ? `Present via ${platform} Sync` : `Absent from ${platform} contest`;

          // Check for MANUAL override — never overwrite manual attendance
          const [overrideCheck] = await connection.query(
            "SELECT attendance_source, attendance_status FROM AttendanceRecords WHERE user_id = ? AND contest_id = ?",
            [student.id, realContestId]
          );
          const hasManualOverride = overrideCheck.length > 0 && overrideCheck[0].attendance_source === 'MANUAL';
          const existingLegacyPresent = overrideCheck.length > 0 && overrideCheck[0].attendance_status === 'PRESENT';

          // Skip if: manual override exists, OR we'd downgrade PRESENT→ABSENT
          if (hasManualOverride || (existingLegacyPresent && legacyStatus === 'ABSENT')) {
            continue;
          }

          await connection.query(`
            INSERT INTO AttendanceRecords (
              user_id, contest_id, contest_name, contest_slug, contest_date, contest_status,
              attendance_status, attendance_source, remarks, \`rank\`, score, problems_solved
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'AUTO', ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              attendance_status = VALUES(attendance_status),
              remarks = VALUES(remarks),
              \`rank\` = VALUES(\`rank\`),
              score = VALUES(score),
              problems_solved = VALUES(problems_solved),
              last_updated = CURRENT_TIMESTAMP
          `, [
            student.id,
            realContestId,
            contest.title,
            slug,
            contest.start_time,
            contest.contest_status || 'RATED',
            legacyStatus,
            remarks,
            status === 'Present' ? rank : null,
            status === 'Present' ? score : null,
            status === 'Present' ? solved : 0
          ]);
        }
      }

      await connection.commit();
      updateProgress(90, 'Database transaction committed successfully.');
    } catch (txErr) {
      await connection.rollback();
      console.error('[Sync Worker] Transaction failed, rolled back:', txErr.message);
      throw txErr;
    } finally {
      connection.release();
    }

    // 5. Invalidate Cache & Recalculate Student summaries
    updateProgress(95, 'Recalculating statistics and updating cache...');
    cache.invalidateAll();

    // Recalculate summary metrics for students (if the recalculate helper is available)
    try {
      const attendanceController = require('../controllers/attendanceController');
      if (typeof attendanceController.recalculateStudentSummary === 'function') {
        for (const student of students) {
          await attendanceController.recalculateStudentSummary(student.id).catch(() => {});
        }
      }
    } catch (sumErr) {
      console.warn('[Sync Worker] Recalculate student summaries skipped:', sumErr.message);
    }

    const syncDurationMs = Date.now() - syncStartTime;

    // Diagnostic summary
    console.log(`[Sync Worker] [DIAGNOSTICS] ========== Attendance Sync Complete ==========`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Contest Slug: "${slug}"`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Total Participants Fetched: ${participants.length}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Students Checked: ${students.length}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Students Matched (Present): ${matchedCount}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Students Absent: ${absentCount}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Students Unknown: ${unknownCount}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Downgrades Prevented: ${skippedDowngradeCount}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Time Taken: ${syncDurationMs}ms`);
    console.log(`[Sync Worker] [DIAGNOSTICS] ================================================`);

    updateProgress(100, 'Synchronization completed successfully.');
    return {
      success: true,
      contestId: realContestId,
      platform,
      participantsCount: participants.length,
      processedStudents: students.length,
      matchedStudents: matchedCount,
      absentStudents: absentCount,
      unknownStudents: unknownCount,
      downgradesPrevented: skippedDowngradeCount,
      fetchSuccess,
      syncDurationMs
    };
  }
}

module.exports = ContestAttendanceSyncService;
