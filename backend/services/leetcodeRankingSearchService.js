const db = require('../config/db');
const NetworkService = require('../utils/networkService');
const cache = require('./analyticsCacheService');
const auditLogSvc = require('./auditLogService');
const { normalizeUsername } = require('../utils/usernameNormalizer');
const DetailedLogger = require('../utils/detailedLogger');
const { contestRankingCache } = require('../utils/contestRankingCache');

const lockKey = Symbol.for('leetcode-sync-locks');
if (!global[lockKey]) {
  global[lockKey] = new Set();
}
const activeSyncLocks = global[lockKey];

// --- Production Constants ---
const DEFAULT_PAGE_SIZE = 25;
const MIN_COMPLETENESS = 0.98; // Minimum fraction of participants that must be fetched

const LeetCodeRankingSearchService = {
  /**
   * Sync contest attendance for a specific LeetCode contest.
   * Fetches all pages, builds map, matches against students, and saves results.
   */
  async syncContestAttendance(contestSlug) {
    const slug = contestSlug.trim().toLowerCase();
    if (activeSyncLocks.has(slug)) {
      throw new Error(`A sync job for contest '${slug}' is already running.`);
    }

    activeSyncLocks.add(slug);
    const startTime = Date.now();
    let totalParticipants = 0;

    try {
      console.log(`[Ranking Search] Starting sync for contest: ${slug}`);

      console.log("Calling LeetCode API...");
      // 1. Fetch Page 1 to verify contest and get total count
      const page1Url = `https://leetcode.com/contest/api/ranking/${slug}/?pagination=1`;
      let page1Data;
      try {
        page1Data = await NetworkService.request(page1Url, {
          method: 'GET',
          useCurlTransport: true,
          retries: 3,
          backoffFactor: 1500
        });
      } catch (err) {
        console.error(`[Ranking Search] Failed to fetch page 1 for ${slug}:`, err.message);
        throw err;
      }

      console.log("Received response");
      if (!page1Data || page1Data.user_num === undefined) {
        throw new Error(`Invalid response schema for contest '${slug}'`);
      }

      totalParticipants = page1Data.user_num;
      // Task 5: Derive page size from actual response instead of magic number
      const pageSize = (page1Data.total_rank && page1Data.total_rank.length) || DEFAULT_PAGE_SIZE;
      const totalPages = Math.ceil(totalParticipants / pageSize);
      console.log(`[Ranking Search] Contest: ${slug} | Participants: ${totalParticipants} | PageSize: ${pageSize} | Total Pages: ${totalPages}`);

      // 2. Fetch all pages concurrently in rate-limited batches
      const participantMap = new Map(); // username (lower) -> ranking_details
      const envConcurrency = parseInt(process.env.LEETCODE_PAGE_CONCURRENCY, 10);
      const concurrencyLimit = Number.isInteger(envConcurrency) && envConcurrency > 0 ? envConcurrency : 2;
      const pageDelayMs = parseInt(process.env.LEETCODE_PAGE_DELAY_MS, 10) || 500;

      // Add page 1 data immediately
      if (page1Data.total_rank) {
        page1Data.total_rank.forEach((item, index) => {
          const usernameKey = normalizeUsername(item.user_slug || item.username);
          if (usernameKey) {
            let solved = 0;
            if (item.submissions) {
              solved = Object.keys(item.submissions).length;
            } else {
              const userSubmissions = page1Data.submissions?.[index] || {};
              solved = Object.values(userSubmissions).filter(s => s && (s.status === 10 || s.status === '10')).length;
            }
            
            participantMap.set(usernameKey, {
              rank: item.rank,
              score: item.score,
              finish_time: item.finish_time,
              solved
            });
          }
        });
      }

      // Fetch remaining pages using atomic work queue & explicit Set tracking
      const fetchedPages = new Set([1]);
      const inFlightPages = new Set();
      const pageQueue = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      const fetchedPagesData = new Map();
      fetchedPagesData.set(1, page1Data);
      const pageErrors = new Map();

      const runWorker = async () => {
        while (true) {
          let currentPage;
          if (pageQueue.length > 0) {
            currentPage = pageQueue.shift();
            inFlightPages.add(currentPage);
          } else {
            break;
          }

          if (pageDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, pageDelayMs));
          }

          let success = false;
          let attempts = 0;
          const maxAttempts = 3;

          while (attempts < maxAttempts && !success) {
            attempts++;
            try {
              const url = `https://leetcode.com/contest/api/ranking/${slug}/?pagination=${currentPage}`;
              const pageData = await NetworkService.request(url, {
                method: 'GET',
                useCurlTransport: true
              });
              if (pageData && pageData.total_rank) {
                fetchedPagesData.set(currentPage, pageData);
                success = true;
                inFlightPages.delete(currentPage);
                fetchedPages.add(currentPage);
              } else {
                throw new Error(`Empty ranking data returned for page ${currentPage}`);
              }
            } catch (err) {
              if (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
              } else {
                pageErrors.set(currentPage, err);
                inFlightPages.delete(currentPage);
                console.error(`[ERROR] Page ${currentPage} failed after ${maxAttempts} attempts: ${err.message}`);
              }
            }
          }
        }
      };

      const workers = [];
      const workerCount = Math.min(concurrencyLimit, pageQueue.length || 1);
      for (let i = 0; i < workerCount; i++) {
        workers.push(runWorker());
      }
      await Promise.all(workers);

      // Retry Failed Transient Pages
      let failedPagesList = Array.from(pageErrors.keys());
      if (failedPagesList.length > 0) {
        console.warn(`[WARN] Starting retry pass for ${failedPagesList.length} failed transient pages...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

        for (const currentPage of failedPagesList) {
          try {
            const url = `https://leetcode.com/contest/api/ranking/${slug}/?pagination=${currentPage}`;
            const pageData = await NetworkService.request(url, {
              method: 'GET',
              useCurlTransport: true
            });
            if (pageData && pageData.total_rank) {
              fetchedPagesData.set(currentPage, pageData);
              pageErrors.delete(currentPage);
              fetchedPages.add(currentPage);
            }
          } catch (err) {
            console.error(`[ERROR] Page ${currentPage} retry failed: ${err.message}`);
          }
        }
      }

      // Merge all successfully fetched pages
      for (let p = 2; p <= totalPages; p++) {
        if (fetchedPagesData.has(p)) {
          const pageData = fetchedPagesData.get(p);
          if (pageData && pageData.total_rank) {
            pageData.total_rank.forEach((item, index) => {
              const usernameKey = normalizeUsername(item.user_slug || item.username);
              if (usernameKey) {
                let solved = 0;
                if (item.submissions) {
                  solved = Object.keys(item.submissions).length;
                } else {
                  const userSubmissions = pageData.submissions?.[index] || {};
                  solved = Object.values(userSubmissions).filter(s => s && (s.status === 10 || s.status === '10')).length;
                }
                
                participantMap.set(usernameKey, {
                  rank: item.rank,
                  score: item.score,
                  finish_time: item.finish_time,
                  solved
                });
              }
            });
          }
        }
      }

      const failedPages = pageErrors.size;

      // Task 2: Compute completeness ratio
      const completeness = totalParticipants > 0 ? participantMap.size / totalParticipants : 1;
      const isIncomplete = completeness < MIN_COMPLETENESS;

      if (participantMap.size === 0) {
        console.warn(`[Ranking Search] [WARNING] Official participant provider returned zero participants for contest "${slug}". Aborting sync to prevent marking everyone absent.`);
        activeSyncLocks.delete(slug);
        return 'SYNC_SKIPPED';
      }

      if (isIncomplete) {
        console.warn(`[Ranking Search] INCOMPLETE FETCH for ${slug}: ${participantMap.size}/${totalParticipants} (${(completeness * 100).toFixed(1)}%) — ${failedPages} pages failed. Missing students will be marked Unknown instead of Absent.`);
      }

      console.log(`[Ranking Search] Finished fetching rankings for ${slug}. Total unique participants in map: ${participantMap.size} | Failed pages: ${failedPages} | Completeness: ${(completeness * 100).toFixed(1)}%`);

      // 3. Ensure Contest exists in Contests table
      let contestId;
      let contestDate = new Date();
      let contestTitle = '';
      const contestCheck = await db.query("SELECT contest_id, title, start_time FROM Contests WHERE slug = ?", [slug]);
      if (contestCheck.length > 0) {
        contestId = contestCheck[0].contest_id;
        contestDate = new Date(contestCheck[0].start_time);
        contestTitle = contestCheck[0].title || '';
        
        const totalProblems = page1Data?.questions?.length || 4;
        await db.query("UPDATE Contests SET total_problems = ? WHERE contest_id = ?", [totalProblems, contestId]);
      } else {
        const contestType = slug.includes('biweekly') ? 'Biweekly' : 'Weekly';
        const match = slug.match(/contest-(\d+)/);
        const contestNumber = match ? parseInt(match[1], 10) : 0;
        contestTitle = contestType + ' Contest ' + contestNumber;
        const totalProblems = page1Data?.questions?.length || 4;
        
        const insertRes = await db.query(
          "INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, total_problems) VALUES (?, ?, ?, ?, NOW(), ?)",
          [contestTitle, slug, contestType, contestNumber, totalProblems]
        );
        contestId = insertRes.insertId;
      }

      // Ensure LiveContests has a corresponding record and get its ID (foreign key for ContestAttendance)
      const liveCheck = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
      let liveContestId;
      if (liveCheck.length > 0) {
        liveContestId = liveCheck[0].id;
        await db.query("UPDATE LiveContests SET status = 'Completed', currentSyncPass = 4 WHERE id = ?", [liveContestId]);
      } else {
        const insertLive = await db.query(`
          INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status, currentSyncPass)
          VALUES ('LeetCode', ?, ?, 'Weekly', NOW() - INTERVAL 2 HOUR, NOW(), 'Completed', 4)
        `, [slug, slug]);
        liveContestId = insertLive.insertId || insertLive;
      }

      // 4. Retrieve all active students from database
      const students = await db.query("SELECT id, name, roll_no, department, section, academic_batch, leetcode_username FROM Users WHERE status = 'active'");
      
      let checkedCount = 0;
      let presentCount = 0;
      let absentCount = 0;
      let unknownCount = 0;
      let skippedDowngradeCount = 0;

      // Match reports lists
      const invalidUsernames = [];
      const duplicateUsernames = new Map();
      const missingUsernames = [];
      const unmatchedStudents = [];

      // Validate usernames
      students.forEach(student => {
        const rawUsername = student.leetcode_username;
        if (!rawUsername || !rawUsername.trim()) {
          missingUsernames.push({ id: student.id, name: student.name, roll_no: student.roll_no });
          return;
        }

        const clean = normalizeUsername(rawUsername);
        
        // Invalid check (alphanumeric + underscore/dash)
        const handleRegex = /^[a-zA-Z0-9_-]+$/;
        if (!handleRegex.test(clean)) {
          invalidUsernames.push({ id: student.id, name: student.name, roll_no: student.roll_no, leetcode_username: rawUsername });
        }

        // Duplicate check
        if (!duplicateUsernames.has(clean)) {
          duplicateUsernames.set(clean, []);
        }
        duplicateUsernames.get(clean).push({ id: student.id, name: student.name, roll_no: student.roll_no });
      });

      // Filter duplicate students
      const duplicateReport = [];
      for (const [username, list] of duplicateUsernames.entries()) {
        if (list.length > 1) {
          duplicateReport.push({ leetcode_username: username, students: list });
        }
      }

      // Task 3: Preload existing records to eliminate N+1 per-student queries
      const existingContestAttendance = new Map();
      const existingAttendanceRecords = new Map();

      try {
        const caRows = await db.query(
          "SELECT studentId, attendanceStatus, syncPass, verified FROM ContestAttendance WHERE contestId = ?",
          [liveContestId]
        );
        for (const row of caRows) {
          existingContestAttendance.set(row.studentId, row);
        }
      } catch (err) {
        console.warn(`[Ranking Search] Could not preload ContestAttendance for contestId=${liveContestId}:`, err.message);
      }

      try {
        const arRows = await db.query(
          "SELECT user_id, attendance_source, attendance_status FROM AttendanceRecords WHERE contest_id = ?",
          [contestId]
        );
        for (const row of arRows) {
          existingAttendanceRecords.set(row.user_id, row);
        }
      } catch (err) {
        console.warn(`[Ranking Search] Could not preload AttendanceRecords for contestId=${contestId}:`, err.message);
      }

      // Task 7: Diagnostics — sync start
      console.log(`[Ranking Search] [DIAGNOSTICS] ========== Attendance Sync Start ==========`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Contest Slug: "${slug}"`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Total Participants: ${totalParticipants}`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Participants Fetched: ${participantMap.size}`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Failed Pages: ${failedPages}`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Completeness: ${(completeness * 100).toFixed(1)}%`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Incomplete Fetch: ${isIncomplete}`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Students to Check: ${students.length}`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Preloaded ContestAttendance: ${existingContestAttendance.size}`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Preloaded AttendanceRecords: ${existingAttendanceRecords.size}`);

      // 5. Match and upsert attendance in batches
      console.log("Writing database...");
      const batchSize = 100;
      for (let i = 0; i < students.length; i += batchSize) {
        const batch = students.slice(i, i + batchSize);

        // Task 4: Wrap each batch in a transaction
        const connection = await db.getPool().getConnection();
        try {
          await connection.beginTransaction();

          for (const student of batch) {
            checkedCount++;
            const rawUsername = student.leetcode_username;
            if (!rawUsername || !rawUsername.trim()) {
              continue;
            }

            const cleanUsername = normalizeUsername(rawUsername);
            const matchResult = participantMap.get(cleanUsername);

            let attendanceStatus = 'ABSENT';
            let rank = null;
            let score = null;
            let finishTime = null;

            let solved = 0;
            if (matchResult) {
              attendanceStatus = 'PRESENT';
              rank = matchResult.rank;
              score = matchResult.score;
              finishTime = matchResult.finish_time;
              solved = matchResult.solved || 0;
              presentCount++;
            } else if (isIncomplete) {
              // Task 2: If fetch is incomplete, mark missing students as Unknown instead of Absent
              attendanceStatus = 'Unknown';
              unknownCount++;
            } else {
              absentCount++;
              unmatchedStudents.push({ id: student.id, name: student.name, roll_no: student.roll_no, leetcode_username: rawUsername });
            }

            // Task 1: Downgrade protection for ContestAttendance
            const existingCA = existingContestAttendance.get(student.id);
            if (existingCA) {
              const existingIsPresent = existingCA.attendanceStatus === 'PRESENT' || existingCA.attendanceStatus === 'Present' || existingCA.attendanceStatus === 'Participating';
              const newIsDowngrade = attendanceStatus === 'Unknown';
              if (existingIsPresent && newIsDowngrade) {
                skippedDowngradeCount++;
                continue; // Skip — preserve the existing Present status across all tables
              }
            }

            // Task 6: Safe numeric parsing — avoid `||` coercing 0 to falsy
            const safeRank = Number.isFinite(rank) ? rank : null;
            const safeScore = Number.isFinite(score) ? score : 0;
            const safeSolved = matchResult ? matchResult.solved : 0;
            const safeFinishTime = Number.isFinite(finishTime) ? finishTime : null;

            // A. Update custom ContestAttendance table
            await connection.query(`
              INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, \`rank\`, solved, score, penalty, verified, syncPass, firstDetectedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 4, NOW())
              ON DUPLICATE KEY UPDATE
                username = VALUES(username),
                attendanceStatus = VALUES(attendanceStatus),
                \`rank\` = VALUES(\`rank\`),
                solved = VALUES(solved),
                score = VALUES(score),
                penalty = VALUES(penalty),
                verified = 1,
                syncPass = 4
            `, [liveContestId, student.id, rawUsername, attendanceStatus, safeRank, safeSolved, safeScore, safeFinishTime]);

            // A2. Update legacy contest_attendance table for backward compatibility
            // Task 1: Only write if not a downgrade (Unknown skips legacy writes entirely)
            if (attendanceStatus !== 'Unknown') {
              await connection.query(`
                INSERT INTO contest_attendance (contest_slug, student_id, leetcode_username, attendance, \`rank\`, score, finish_time, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                  leetcode_username = VALUES(leetcode_username),
                  attendance = VALUES(attendance),
                  \`rank\` = VALUES(\`rank\`),
                  score = VALUES(score),
                  finish_time = VALUES(finish_time),
                  synced_at = NOW()
              `, [slug, student.id, rawUsername, attendanceStatus === 'PRESENT' ? 'PRESENT' : 'ABSENT', safeRank, safeScore, safeFinishTime]);
            }

            // B. Update legacy/primary AttendanceRecords table for backward compatibility
            const existingAR = existingAttendanceRecords.get(student.id);
            const hasManualOverride = existingAR && existingAR.attendance_source === 'MANUAL';
            const existingLegacyPresent = existingAR && existingAR.attendance_status === 'PRESENT';
            const legacyStatus = attendanceStatus === 'PRESENT' ? 'PRESENT' : 'ABSENT';

            // Skip if: manual override exists, Unknown status, OR (fetch is incomplete AND would downgrade PRESENT→ABSENT)
            if (hasManualOverride || attendanceStatus === 'Unknown' || (isIncomplete && existingLegacyPresent && legacyStatus === 'ABSENT')) {
              continue;
            }

            await connection.query(`
              INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, contest_status, attendance_status, attendance_source, \`rank\`, score, problems_solved, remarks)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'AUTO', ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                attendance_status = VALUES(attendance_status),
                attendance_source = 'AUTO',
                \`rank\` = VALUES(\`rank\`),
                score = VALUES(score),
                problems_solved = VALUES(problems_solved),
                remarks = VALUES(remarks)
            `, [student.id, contestId, contestTitle, slug, contestDate, 'RATED', legacyStatus, safeRank, safeScore, safeSolved, finishTime ? JSON.stringify({ finish_time: finishTime }) : null]);
          }

          await connection.commit();
        } catch (batchErr) {
          await connection.rollback();
          console.error(`[Ranking Search] Transaction failed for batch starting at index ${i}, rolled back:`, batchErr.message);
        } finally {
          connection.release();
        }
      }

      const syncDurationMs = Date.now() - startTime;

      // Task 7: Diagnostics — sync end
      console.log(`[Ranking Search] [DIAGNOSTICS] ========== Attendance Sync Complete ==========`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Contest Slug: "${slug}"`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Students Checked: ${checkedCount}`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Students Present: ${presentCount}`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Students Absent: ${absentCount}`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Students Unknown: ${unknownCount}`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Downgrades Prevented: ${skippedDowngradeCount}`);
      console.log(`[Ranking Search] [DIAGNOSTICS] Time Taken: ${syncDurationMs}ms`);
      console.log(`[Ranking Search] [DIAGNOSTICS] ================================================`);

      console.log(`[Ranking Search] Sync Complete for ${slug}: Checked=${checkedCount}, Present=${presentCount}, Absent=${absentCount}, Unknown=${unknownCount}, DowngradesPrevented=${skippedDowngradeCount}, Duration=${syncDurationMs}ms`);

      // 6. Log in system audit log
      await auditLogSvc.log('LEETCODE_CONTEST_ATTENDANCE_SYNC', {
        actor: 'SYSTEM',
        targetType: 'contest_attendance_sync',
        targetId: slug,
        details: {
          contestSlug: slug,
          totalParticipants,
          totalStudentsChecked: checkedCount,
          presentCount,
          absentCount,
          unknownCount,
          skippedDowngradeCount,
          completeness: (completeness * 100).toFixed(1) + '%',
          failedPages,
          syncDurationMs
        }
      });

      // 7. Clear caches
      cache.invalidateAll();

      return {
        success: true,
        totalParticipants,
        totalStudentsChecked: checkedCount,
        presentCount,
        absentCount,
        unknownCount,
        skippedDowngradeCount,
        completeness: (completeness * 100).toFixed(1) + '%',
        syncDurationMs,
        auditReport: {
          invalidUsernames,
          duplicateUsernames: duplicateReport,
          missingUsernames,
          unmatchedStudents
        }
      };
    } finally {
      activeSyncLocks.delete(slug);
    }
  }
};

module.exports = LeetCodeRankingSearchService;
