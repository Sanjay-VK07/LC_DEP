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

    try {
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
    } catch (dbErr) {
      console.warn(`[Sync Worker] DB contest lookup warning (${dbErr.message}). Resolving directly from slug...`);
      if (typeof contestId === 'string') {
        contestRows = [{
          contest_id: 1,
          platform: 'LeetCode',
          title: contestId,
          start_time: new Date(),
          slug: contestId,
          contest_status: 'RATED',
          duration: 5400
        }];
      }
    }

    const slugToCheck = contestRows[0]?.slug || liveContest?.contestSlug || '';
    const isMock = slugToCheck.toLowerCase().startsWith('test-') || 
                   slugToCheck.toLowerCase().startsWith('mock-') || 
                   slugToCheck.toLowerCase().startsWith('dummy-') || 
                   slugToCheck.toLowerCase().startsWith('upcoming-live-');
    if (isMock) {
      console.log(`[Sync Worker] Skipping mock/test/dummy contest "${slugToCheck}"`);
      return { success: true, message: 'Mock/test contest skipped' };
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
      // ── FIX: LiveContests row exists but Contests row is missing.
      // We MUST create the Contests row first because AttendanceRecords.contest_id
      // is a foreign key referencing Contests.contest_id — NOT LiveContests.id.
      // Using liveContest.id as realContestId would produce orphaned AttendanceRecords.
      platform = liveContest.platform || 'LeetCode';
      slug = liveContest.contestSlug;
      const duration = Math.round((new Date(liveContest.endTime) - new Date(liveContest.startTime)) / 1000);
      const contestType = slug.includes('biweekly') ? 'Biweekly' : 'Weekly';
      const matchNum = slug.match(/contest-(\d+)/);
      const contestNumber = matchNum ? parseInt(matchNum[1], 10) : 0;

      console.log(`[Sync Worker] [FIX] Contests row missing for slug "${slug}". Creating it now...`);
      const insertResult = await db.query(`
        INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
        VALUES (?, ?, ?, ?, ?, ?, 'Rated', ?, 'SYNC')
        ON DUPLICATE KEY UPDATE title = VALUES(title), start_time = VALUES(start_time)
      `, [liveContest.contestName, slug, contestType, contestNumber, liveContest.startTime, duration, platform]);

      // Re-fetch to get the correct contest_id
      const refetch = await db.query(
        'SELECT contest_id FROM Contests WHERE slug = ?', [slug]
      );
      realContestId = refetch[0]?.contest_id || insertResult.insertId;

      contest = {
        contest_id: realContestId,
        platform,
        title: liveContest.contestName,
        start_time: liveContest.startTime,
        slug,
        contest_status: 'RATED',
        duration
      };
      console.log(`[Sync Worker] [FIX] Contests row created/resolved. contest_id=${realContestId}, slug="${slug}"`);
    }

    console.log(`[Sync Worker] [DIAGNOSTICS] ========== Attendance Sync Start ==========`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Contest Slug: "${slug}"`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Platform: ${platform}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Sync Pass: ${pass}`);

    updateProgress(15, `Resolved contest: ${contest.title} (${platform})`);

    // 2. Select Platform Adapter
    const adapter = getAdapter(platform);

    // 2b. Fetch active students up front so we can pass their handles to the
    // adapter for registered-roster verification (enables an honest
    // VERIFIED_FOR_REGISTERED_STUDENTS result instead of blind full-leaderboard fetches).
    let students = [];
    try {
      students = await db.query(
        "SELECT id, name, leetcode_username, codeforces_username, codechef_username, hackerrank_username FROM Users WHERE status = 'active'"
      );
    } catch (dbErr) {
      console.warn(`[Sync Worker] Could not load active students from DB: ${dbErr.message}`);
    }
    const platLowerForRoster = platform.toLowerCase();
    const registeredUsernames = students
      .map(s => normalizeUsername(s[`${platLowerForRoster}_username`]))
      .filter(Boolean);

    // 3. Fetch Contest Participants (with up to 3 retries)
    updateProgress(30, 'Retrieving participants from platform adapter...');
    let participants = [];
    let fetchSuccess = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        participants = await adapter.getContestParticipants(slug, { registeredUsernames });
        if (participants && participants.length > 0) {
          fetchSuccess = true;
          break;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[Sync Worker] Attempt ${attempt} failed to fetch participants for ${platform} contest "${slug}": ${err.message}`);
        if (err.code === 'TEMPORARILY_UNAVAILABLE' || err.status === 'TEMPORARILY_UNAVAILABLE' || err.syncStatus === 'NOT_VERIFIED') {
          // Immediately exit retries when sources are unavailable
          break;
        }
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    // Build participant lookup map with normalized usernames from fetched participants
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
      console.log(`[Sync Worker] [DIAGNOSTICS] Unique Normalized Entries in map: ${participantMap.size}`);
    }

    // ATTENDANCE SAFETY GUARANTEE:
    // 1. If leaderboard is complete (leaderboardComplete === true) -> FULL SUCCESS
    // 2. If leaderboard is incomplete BUT attendanceVerified === true -> VERIFIED_FOR_REGISTERED_STUDENTS
    // 3. If attendanceVerified === false OR fetch failed -> NOT_VERIFIED (0 false absences, preserve existing records)
    const isVerifiedForStudents = participants && (participants.attendanceVerified === true || participants.syncStatus === 'VERIFIED_FOR_REGISTERED_STUDENTS');
    const isFullSuccess = fetchSuccess && participants && (participants.leaderboardComplete === true || participants.syncStatus === 'SUCCESS');

    if (!fetchSuccess || participants.length === 0 || (!isFullSuccess && !isVerifiedForStudents)) {
      const reason = lastError ? lastError.message : 'Upstream participant data unavailable or attendance not verified';
      console.warn(`[CONTEST_SYNC] Contest: ${slug} | Source: NOT_VERIFIED | Participants: ${participants ? participants.length : 0} | Status: NOT_VERIFIED | Reason: ${reason}`);
      console.warn(`[Sync Worker] [ATTENDANCE SAFETY] Preserving existing attendance records without marking false absences.`);

      try {
        await db.query(
          "INSERT INTO sync_logs (status, message, started_at, completed_at) VALUES ('warning', ?, NOW(), NOW())",
          [`Sync postponed for contest "${slug}": ${reason}. Existing attendance preserved.`]
        );
      } catch (_) {}

      updateProgress(100, `Synchronization postponed: ${reason}. Existing attendance preserved.`);
      return {
        success: false,
        status: 'NOT_VERIFIED',
        syncStatus: 'NOT_VERIFIED',
        contest: slug,
        participants: [],
        source: null,
        message: 'Contest participant data is currently unverified. Existing attendance preserved.'
      };
    }

    console.log(`[Sync Worker] [DIAGNOSTICS] Students to Check: ${students.length}`);
    updateProgress(75, `Generating attendance mapping for ${students.length} students...`);

    if (students.length === 0) {
      console.log(`[Sync Worker] No active students to process or DB unavailable. Returning fetched participant summary.`);
      return {
        success: true,
        contestId: realContestId,
        platform,
        participantsCount: participants.length,
        processedStudents: 0,
        matchedStudents: 0,
        absentStudents: 0,
        unknownStudents: 0,
        downgradesPrevented: 0,
        fetchSuccess,
        syncDurationMs: Date.now() - syncStartTime
      };
    }

    // Resolve or insert LiveContests record
    let liveContestId = null;
    try {
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
    } catch (liveErr) {
      console.warn(`[Sync Worker] LiveContests query warning: ${liveErr.message}`);
    }

    let connection = null;
    try {
      const pool = db.getPool();
      if (pool) {
        connection = await pool.getConnection();
      }
    } catch (poolErr) {
      console.warn(`[Sync Worker] DB Pool warning: ${poolErr.message}`);
    }

    if (!connection) {
      console.log(`[Sync Worker] DB connection pool unavailable. Skipping student DB row mapping.`);
      return {
        success: true,
        contestId: realContestId,
        platform,
        participantsCount: participants.length,
        processedStudents: students.length,
        matchedStudents: 0,
        absentStudents: 0,
        unknownStudents: 0,
        downgradesPrevented: 0,
        fetchSuccess,
        syncDurationMs: Date.now() - syncStartTime
      };
    }
    let matchedCount = 0;
    let absentCount = 0;
    let unknownCount = 0;
    let skippedDowngradeCount = 0;

    let recoveredCount = 0;
    let recoveredContestParticipants = 0;
    let recoveredRank = 0;
    let recoveredScore = 0;
    let recoveredFinishTime = 0;
    let skippedUnmatchedCount = 0;

    try {
      await connection.beginTransaction();

      for (const student of students) {
        const platLower = platform.toLowerCase();
        const handle = student[`${platLower}_username`];

        let rank = null;
        let score = 0.00;
        let penalty = 0;
        let solved = 0;
        let ratingBefore = null;

        // Fetch existing records from database
        const [existingRecord] = await connection.query(
          "SELECT attendanceStatus, `rank`, score, penalty, solved, syncPass, verified FROM ContestAttendance WHERE contestId = ? AND studentId = ?",
          [liveContestId, student.id]
        );

        // Check for manual override / existing legacy record
        const [overrideCheck] = await connection.query(
          "SELECT attendance_source, attendance_status, `rank`, score, problems_solved FROM AttendanceRecords WHERE user_id = ? AND contest_id = ?",
          [student.id, realContestId]
        );

        let existingIsPresent = false;
        let existingIsVerified = false;
        let existingHigherPass = false;
        let existingRank = null;
        let existingScore = 0.00;
        let existingPenalty = 0;
        let existingSolved = 0;

        if (existingRecord.length > 0) {
          const existing = existingRecord[0];
          existingIsPresent = existing.attendanceStatus === 'Present' || existing.attendanceStatus === 'Participating';
          existingIsVerified = existing.verified === 1;
          existingHigherPass = existing.syncPass > pass;
          existingRank = existing.rank;
          existingScore = parseFloat(existing.score) || 0.00;
          existingPenalty = existing.penalty || 0;
          existingSolved = existing.solved || 0;
        }

        let legacyRank = null;
        let legacyScore = 0.00;
        let legacySolved = 0;
        if (overrideCheck.length > 0) {
          const legacy = overrideCheck[0];
          legacyRank = legacy.rank;
          legacyScore = parseFloat(legacy.score) || 0.00;
          legacySolved = legacy.problems_solved || 0;
        }

        const cleanHandle = handle ? normalizeUsername(handle) : null;
        const match = cleanHandle ? participantMap.get(cleanHandle) : null;
        const participantExists = !!match;

        const resolvedRank = (match && match.rank !== null) ? match.rank : 
                             (existingRank !== null ? existingRank : legacyRank);
        const resolvedScore = (match && match.score !== null) ? match.score : 
                              (existingScore > 0 ? existingScore : legacyScore);
        const resolvedPenalty = (match && (match.finishTime !== null && match.finishTime !== undefined)) ? match.finishTime : existingPenalty;
        const resolvedSolved = (match && (match.problemsSolved !== null && match.problemsSolved !== undefined)) ? match.problemsSolved : 
                               (existingSolved > 0 ? existingSolved : legacySolved);

        const hasRank = resolvedRank !== null;
        const hasScore = resolvedScore > 0;
        const hasFinishTime = resolvedPenalty > 0;

        let isPresent = false;
        let recoveryReason = null;

        // Precedence checks
        if (participantExists) {
          isPresent = true;
          recoveryReason = 'ContestParticipants';
        } else if (hasRank) {
          isPresent = true;
          recoveryReason = 'Rank';
        } else if (hasScore) {
          isPresent = true;
          recoveryReason = 'Score';
        } else if (hasFinishTime) {
          isPresent = true;
          recoveryReason = 'FinishTime';
        }

        let dbStatus = 'Absent';
        let legacyStatus = 'ABSENT';

        // Safety: Keep as Present if it was previously marked Present
        if (existingIsPresent && !isPresent) {
          isPresent = true;
          dbStatus = 'Present';
          legacyStatus = 'PRESENT';
          rank = existingRank;
          score = existingScore;
          penalty = existingPenalty;
          solved = existingSolved;
          matchedCount++;
        } else if (isPresent) {
          dbStatus = 'Present';
          legacyStatus = 'PRESENT';
          rank = resolvedRank;
          score = resolvedScore;
          penalty = resolvedPenalty;
          solved = resolvedSolved;
          matchedCount++;
        } else {
          dbStatus = 'Absent';
          legacyStatus = 'ABSENT';
          absentCount++;
        }

        // Track recovery stats
        const existingIsAbsent = (existingRecord.length > 0 && existingRecord[0].attendanceStatus === 'Absent') ||
                                 (overrideCheck.length > 0 && overrideCheck[0].attendance_status === 'ABSENT');

        if (isPresent && existingIsAbsent) {
          recoveredCount++;
          if (recoveryReason === 'ContestParticipants') {
            recoveredContestParticipants++;
          } else if (recoveryReason === 'Rank') {
            recoveredRank++;
          } else if (recoveryReason === 'Score') {
            recoveredScore++;
          } else if (recoveryReason === 'FinishTime') {
            recoveredFinishTime++;
          }
        }

        if (!isPresent) {
          skippedUnmatchedCount++;
        }

        // Fetch rating before sync if Present
        if (dbStatus === 'Present') {
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
        if (existingIsPresent) {
          // Unknown must never overwrite Present
          if (dbStatus === 'Unknown') {
            skippedDowngradeCount++;
            continue; // Skip — preserve the existing Present status
          }
          // If existing record is Present (from a verified or higher-pass sync),
          // and the new status is Absent, skip this update.
          if (dbStatus === 'Absent' && (existingIsVerified || existingHigherPass)) {
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
          dbStatus,
          rank,
          dbStatus === 'Present' ? solved : 0,
          score,
          penalty,
          ratingBefore,
          pass === 4 ? 1 : 0,
          pass
        ]);

        // B. Insert/Update in AttendanceRecords (legacy dashboard table) if status is not Unknown
        if (dbStatus !== 'Unknown') {
          const remarks = dbStatus === 'Present' ? `Present via ${platform} Sync` : `Absent from ${platform} contest`;

          // Check for MANUAL override — never overwrite manual attendance
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
            legacyStatus === 'PRESENT' ? rank : null,
            legacyStatus === 'PRESENT' ? score : null,
            legacyStatus === 'PRESENT' ? solved : 0
          ]);
        }
      }

      // Consistent updates for BOTH tables inside the same transaction
      await connection.query(`
        UPDATE ContestAttendance
        SET attendanceStatus = 'PRESENT'
        WHERE contestId = ? AND attendanceStatus = 'ABSENT'
          AND (\`rank\` IS NOT NULL OR score > 0.00 OR penalty > 0)
      `, [liveContestId]);

      await connection.query(`
        UPDATE AttendanceRecords
        SET attendance_status = 'PRESENT',
            remarks = COALESCE(remarks, 'Present via Sync Recovery')
        WHERE contest_id = ? AND attendance_status = 'ABSENT'
          AND (\`rank\` IS NOT NULL OR score > 0.00)
      `, [realContestId]);

      await connection.query(`
        UPDATE AttendanceRecords ar
        JOIN Contests c ON ar.contest_id = c.contest_id
        JOIN LiveContests lc ON c.slug = lc.contestSlug
        JOIN ContestAttendance ca ON lc.id = ca.contestId AND ar.user_id = ca.studentId
        SET ar.attendance_status = 'PRESENT',
            ar.\`rank\` = COALESCE(ar.\`rank\`, ca.\`rank\`),
            ar.score = COALESCE(ar.score, ca.score),
            ar.problems_solved = COALESCE(ar.problems_solved, ca.solved),
            ar.remarks = COALESCE(ar.remarks, 'Present via Sync Recovery')
        WHERE ca.contestId = ? AND ca.attendanceStatus = 'PRESENT'
          AND ar.attendance_status = 'ABSENT'
      `, [liveContestId]);

      await connection.query(`
        UPDATE ContestAttendance ca
        JOIN LiveContests lc ON ca.contestId = lc.id
        JOIN Contests c ON lc.contestSlug = c.slug
        JOIN AttendanceRecords ar ON c.contest_id = ar.contest_id AND ca.studentId = ar.user_id
        SET ca.attendanceStatus = 'PRESENT',
            ca.\`rank\` = COALESCE(ca.\`rank\`, ar.\`rank\`),
            ca.score = COALESCE(ca.score, ar.score),
            ca.solved = COALESCE(ca.solved, ar.problems_solved)
        WHERE ca.contestId = ? AND ar.attendance_status = 'PRESENT'
          AND ca.attendanceStatus = 'ABSENT'
          AND (ar.\`rank\` IS NOT NULL OR ar.score > 0.00)
      `, [liveContestId]);

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
    console.log(`[Sync Worker] [DIAGNOSTICS] Contest: "${slug}"`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Participants synced: ${participants.length}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Present count: ${matchedCount}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Absent count: ${absentCount}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Recovered records: ${recoveredCount}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Skipped unmatched students: ${skippedUnmatchedCount}`);
    console.log(`[Sync Worker] [DIAGNOSTICS] Recovered because of:`);
    console.log(`[Sync Worker] [DIAGNOSTICS]   ContestParticipants: ${recoveredContestParticipants}`);
    console.log(`[Sync Worker] [DIAGNOSTICS]   Rank: ${recoveredRank}`);
    console.log(`[Sync Worker] [DIAGNOSTICS]   Score: ${recoveredScore}`);
    console.log(`[Sync Worker] [DIAGNOSTICS]   FinishTime: ${recoveredFinishTime}`);
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
