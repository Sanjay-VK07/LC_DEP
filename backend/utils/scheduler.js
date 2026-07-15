const cron = require('node-cron');
const db = require('../config/db');
const leetcode = require('./leetcode');
const standingsProvider = require('./standingsProvider');
const { normalizeUsername } = require('../utils/usernameNormalizer');
const LeetCodeConnector = require('../services/connectors/LeetCodeConnector');
const CodeChefConnector = require('../services/connectors/CodeChefConnector');
const CodeforcesConnector = require('../services/connectors/CodeforcesConnector');
const HackerRankConnector = require('../services/connectors/HackerRankConnector');

const connectors = {
  leetcode: LeetCodeConnector,
  codechef: CodeChefConnector,
  codeforces: CodeforcesConnector,
  hackerrank: HackerRankConnector
};

const validationSvc = require('../services/dataValidationService');
const matchingSvc = require('../services/contestMatchingService');
const auditLogSvc = require('../services/auditLogService');
const platformHealthSvc = require('../services/platformHealthService');
const cache = require('../services/analyticsCacheService');
const notificationSvc = require('../services/notificationService');

// Sleep helper to prevent LeetCode rate limits
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatDate(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Perform synchronization of contest data for all active students.
 * Uses EntrantHub as the primary source of contest metadata.
 */
async function syncAllData() {
  const startedAt = new Date();
  console.log(`[Sync] Starting EnthraHub contest synchronization at ${startedAt.toISOString()}...`);

  let logId = null;
  try {
    const logResult = await db.query(
      "INSERT INTO sync_logs (status, message, contests_synced, students_processed, started_at) VALUES (?, ?, ?, ?, ?)",
      ['running', 'Sync started', 0, 0, startedAt]
    );
    logId = logResult.insertId;
  } catch (err) {
    console.error('[Sync] Failed to create sync log in DB:', err.message);
  }

  try {
    // 1. Fetch all active students
    const users = await db.query(
      "SELECT id, name, roll_no, department, section, leetcode_username, codechef_username, codeforces_username, hackerrank_username, academic_start_date, academic_end_date FROM Users WHERE status = 'active'"
    );

    if (users.length === 0) {
      console.log('[Sync] No active students found in database.');
      if (logId) {
        await db.query(
          "UPDATE sync_logs SET status = ?, message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
          ['success', 'No active students to process', logId]
        );
      }
      return { success: true, message: 'No active students to process', contestsSynced: 0, studentsProcessed: 0 };
    }

    console.log(`[Sync] Found ${users.length} active student(s) to process.`);

    // 2. Fetch master contest list from standingsProvider
    console.log('[Sync] Fetching master contests list from standingsProvider...');
    const entranthubContests = await standingsProvider.fetchUpcomingContests();
    console.log(`[Sync] Retrieved ${entranthubContests.length} contests from standingsProvider.`);

    const now = new Date();

    // Sync Contests metadata from EntrantHub
    let newlyAdded = 0;
    let updatedContests = 0;

    for (const contest of entranthubContests) {
      const slug = contest.contest_slug;
      const title = contest.contest_name;
      const startTimeDate = new Date(contest.contest_date);
      const duration = 5400; // standard duration
      const contestStatus = contest.contest_status === 'UNRATED' ? 'Unrated' : 'Rated';
      const contestType = slug.includes('biweekly') ? 'Biweekly' : 'Weekly';
      const match = slug.match(/contest-(\d+)/);
      const contestNumber = match ? parseInt(match[1], 10) : 0;

      const existing = await db.query("SELECT contest_id, title, start_time FROM Contests WHERE slug = ?", [slug]);

      if (existing.length === 0) {
        await db.query(`
          INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [title, slug, contestType, contestNumber, startTimeDate, duration, contestStatus]);
        newlyAdded++;
      } else {
        await db.query(`
          UPDATE Contests 
          SET title = ?, start_time = ?, duration = ?, contest_status = ?
          WHERE slug = ?
        `, [title, startTimeDate, duration, contestStatus, slug]);
        updatedContests++;
      }
    }

    console.log(`[Sync] Newly Added Contests: ${newlyAdded}, Updated Contests: ${updatedContests}`);

    // 3. Fetch platform profile analytics and update each platform profile table
    let studentsProcessed = 0;

    for (const user of users) {
      try {
        for (const platform of Object.keys(connectors)) {
          await syncStudentPlatform(user.id, platform, false);
        }
        studentsProcessed++;
        await sleep(600); // Prevent rate limits
      } catch (err) {
        console.error(`[Sync] Failed to refresh platform profiles for user ${user.name}:`, err.message);
      }
    }

    // 4. Finalize attendance for ended/ongoing contests based on ParticipationLogs & Leaderboards
    console.log('[Sync] Finalizing attendance records for ended/ongoing contests...');
    const endedContests = await db.query(
      "SELECT contest_id, title, slug, start_time, platform FROM Contests WHERE start_time <= NOW() AND contest_status != 'Cancelled' AND source = 'ENTRANTHUB'"
    );

    let finalizedCount = 0;
    for (const contest of endedContests) {
      const contestStartTime = new Date(contest.start_time);
      
      // Get all active users eligible for this contest date and who have a handle for this platform
      const eligibleUsers = users.filter(u => {
        const platformKey = contest.platform ? contest.platform.toLowerCase() : 'leetcode';
        const handle = u[`${platformKey}_username`];
        if (!handle || !handle.trim()) return false;

        const start = new Date(u.academic_start_date);
        const end = new Date(u.academic_end_date);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        return contestStartTime >= start && contestStartTime <= end;
      });

      // Fetch official participants from standingsProvider
      let providerParticipants = [];
      try {
        providerParticipants = await standingsProvider.fetchStandings(contest.platform || 'LeetCode', contest.slug);
        console.log(`[Sync] Fetched ${providerParticipants.length} official participants from standingsProvider for ${contest.slug}`);
      } catch (err) {
        console.warn(`[Sync] Failed to fetch participants for ${contest.slug}:`, err.message);
      }

      // Zero Participant Protection
      if (providerParticipants.length === 0) {
        console.warn(`[Sync] [WARNING] standingsProvider returned 0 participants for contest "${contest.slug}". Skipping attendance finalization to prevent downgrades.`);
        continue;
      }

      // Normalize participants
      const normalizedEHParticipants = new Set(
        providerParticipants.map(p => p.username).filter(Boolean)
      );

      for (const user of eligibleUsers) {
        const platformKey = contest.platform ? contest.platform.toLowerCase() : 'leetcode';
        const rawUsername = user[`${platformKey}_username`] || '';
        const usernameNorm = normalizeUsername(rawUsername);

        // Check if we have a local participation log
        const logCheck = await db.query(
          "SELECT id FROM ParticipationLogs WHERE user_id = ? AND contest_id = ?",
          [user.id, contest.contest_id]
        );
        let attended = logCheck.length > 0;

        // Check if they are marked Present in ContestAttendance (official platform sync)
        if (!attended && usernameNorm) {
          const syncCheck = await db.query(`
            SELECT ca.attendanceStatus 
            FROM ContestAttendance ca
            JOIN LiveContests lc ON ca.contestId = lc.id
            WHERE ca.studentId = ? AND lc.contestSlug = ? AND (ca.attendanceStatus = 'Present' OR ca.attendanceStatus = 'Participating')
          `, [user.id, contest.slug]);
          
          if (syncCheck.length > 0) {
            attended = true;
          }
        }

        // Auto-match student if found in the official rankings list (EntrantHub)
        if (!attended && usernameNorm && normalizedEHParticipants.has(usernameNorm)) {
          attended = true;
          // Ensure they are registered
          await db.query(
            "INSERT IGNORE INTO Registrations (user_id, contest_id) VALUES (?, ?)",
            [user.id, contest.contest_id]
          );
          // Insert participation log
          await db.query(
            `INSERT INTO ParticipationLogs (user_id, contest_id, join_time, participation_status)
             VALUES (?, ?, CURRENT_TIMESTAMP, 'JOINED')
             ON DUPLICATE KEY UPDATE participation_status = 'JOINED'`,
            [user.id, contest.contest_id]
          );
        }

        // Diagnostics output — removed from hot path to avoid log spam

        // Check if we already have a record in AttendanceRecords
        const existingRecord = await db.query(
          "SELECT `rank`, score, attendance_status, attendance_source FROM AttendanceRecords WHERE user_id = ? AND contest_id = ?",
          [user.id, contest.contest_id]
        );
        let rank = existingRecord[0]?.rank ?? null;
        let score = existingRecord[0]?.score ?? null;

        const status = attended ? 'PRESENT' : 'ABSENT';

        let finalStatus = status;
        let finalSource = 'AUTO';

        if (existingRecord.length > 0) {
          const existing = existingRecord[0];
          if (existing.attendance_source === 'MANUAL') {
            finalStatus = existing.attendance_status;
            finalSource = 'MANUAL';
          } else if (existing.attendance_status === 'PRESENT' && status === 'ABSENT') {
            // Downgrade protection: preserve PRESENT status
            finalStatus = 'PRESENT';
          }
        }

        await db.query(`
          INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, attendance_status, attendance_source, \`rank\`, score, participated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            attendance_status = VALUES(attendance_status),
            attendance_source = VALUES(attendance_source),
            \`rank\` = IFNULL(\`rank\`, VALUES(\`rank\`)),
            score = IFNULL(score, VALUES(score)),
            participated = VALUES(participated)
        `, [user.id, contest.contest_id, contest.title, contest.slug, contest.start_time, finalStatus, finalSource, rank, score, finalStatus === 'PRESENT' ? 1 : 0]);
      }
      finalizedCount++;
    }

    console.log(`[Sync] Finalized attendance for ${finalizedCount} completed contests.`);

    // Update last_synced_at for all finalized contests
    const allContestsToUpdate = await db.query(
      "SELECT contest_id FROM Contests WHERE start_time <= NOW() AND contest_status != 'Cancelled'"
    );
    if (allContestsToUpdate.length > 0) {
      const ids = allContestsToUpdate.map(c => c.contest_id);
      const placeholders = ids.map(() => '?').join(',');
      await db.query(
        `UPDATE Contests SET last_synced_at = CURRENT_TIMESTAMP WHERE contest_id IN (${placeholders})`,
        ids
      );
    }

    if (logId) {
      await db.query(
        "UPDATE sync_logs SET status = ?, message = ?, contests_synced = ?, students_processed = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
        ['success', 'Synchronization completed successfully', endedContests.length, studentsProcessed, logId]
      );
    }

    // Invalidate analytics cache after successful sync
    cache.invalidateAll();
    console.log('[Sync] Analytics cache invalidated after successful sync.');

    // Send sync completion notification
    const syncDuration = Math.round((Date.now() - startedAt.getTime()) / 1000);
    await notificationSvc.notifySyncComplete({
      contestsSynced: endedContests.length,
      studentsProcessed,
      duration: `${syncDuration}s`
    });

    return {
      success: true,
      contestsSynced: endedContests.length,
      studentsProcessed,
      message: 'Synchronization completed successfully'
    };

  } catch (error) {
    console.error('[Sync] Fatal error during synchronization:', error.message);
    if (logId) {
      await db.query(
        "UPDATE sync_logs SET status = ?, message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
        ['failed', `Error: ${error.message}`, logId]
      );
    }
    throw error;
  }
}

/**
 * Seed all Weekly and Biweekly contests from LeetCode GraphQL API into the local DB.
 */
async function seedMasterContests() {
  console.log('[DB Seed] Starting LeetCode Master Contests seeding...');
  try {
    const leetcodeContests = await leetcode.getRecentContests();
    console.log(`[DB Seed] Retrieved ${leetcodeContests.length} contests from LeetCode GraphQL API.`);

    let insertCount = 0;
    for (const contest of leetcodeContests) {
      const slug = contest.titleSlug;
      const title = contest.title;
      const startTimeDate = new Date(contest.startTime * 1000);
      const duration = contest.duration || 5400;
      const contestStatus = (slug.includes('biweekly-contest-126') || slug.includes('biweekly-contest-127')) ? 'Unrated' : 'Rated';
      const contestType = slug.includes('biweekly') ? 'Biweekly' : 'Weekly';
      const match = slug.match(/contest-(\d+)/);
      const contestNumber = match ? parseInt(match[1], 10) : 0;

      await db.query(`
        INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE title = VALUES(title), start_time = VALUES(start_time), duration = VALUES(duration), contest_status = VALUES(contest_status)
      `, [title, slug, contestType, contestNumber, startTimeDate, duration, contestStatus]);
      insertCount++;
    }
    console.log(`[DB Seed] Seeding complete. Processed ${insertCount} contests.`);
    return { success: true, count: insertCount };
  } catch (err) {
    console.error('[DB Seed] Error during LeetCode contests seeding:', err.message);
    throw err;
  }
}

/**
 * Initialize background cron job (runs daily at 1:00 AM)
 */
function initScheduler() {
  console.log('[Scheduler] Initializing automated daily standings sync (1:00 AM)...');
  
  cron.schedule('0 1 * * *', async () => {
    console.log('[Scheduler] Executing scheduled daily sync...');
    try {
      await syncAllData();
      console.log('[Scheduler] Scheduled daily sync executed successfully.');

      // Run daily alerts checks
      console.log('[Scheduler] Executing daily alerts generation...');
      await notificationSvc.generateMissingHandleAlerts();
      await notificationSvc.generateUpcomingContestAlerts();
      await notificationSvc.generateLowAttendanceAlerts(50);
    } catch (err) {
      console.error('[Scheduler] Scheduled daily sync failed:', err.message);
    }
  });
}

async function ensureContestInDb(platform, entry) {
  let title, slug, startTime, duration, contestStatus, contestType, contestNumber;

  if (platform.toLowerCase() === 'leetcode') {
    title = entry.contest?.title || entry.contestName || 'Unknown LeetCode Contest';
    slug = entry.contest?.titleSlug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const startSec = entry.contest?.startTime || (entry.contestDate ? Math.floor(new Date(entry.contestDate).getTime() / 1000) : Math.floor(Date.now() / 1000));
    startTime = new Date(startSec * 1000);
    duration = entry.contest?.duration || 5400;
    contestStatus = (slug.includes('biweekly-contest-126') || slug.includes('biweekly-contest-127')) ? 'Unrated' : 'Rated';
    contestType = slug.includes('biweekly') ? 'Biweekly' : 'Weekly';
    const match = slug.match(/contest-(\d+)/);
    contestNumber = match ? parseInt(match[1], 10) : 0;
  } else if (platform.toLowerCase() === 'codechef') {
    title = entry.contestName || 'Unknown CodeChef Contest';
    slug = 'codechef-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    startTime = entry.contestDate ? new Date(entry.contestDate) : new Date();
    duration = 10800; // CodeChef Starters are usually 3 hours
    contestStatus = 'Rated';
    contestType = 'Weekly';
    const match = title.match(/Starters\s+(\d+)/i) || slug.match(/starters-(\d+)/i);
    contestNumber = match ? parseInt(match[1], 10) : 0;
  } else if (platform.toLowerCase() === 'codeforces') {
    title = entry.contestName || `Codeforces Contest ${entry.contestId}`;
    slug = 'codeforces-' + (entry.contestId || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    const startSec = entry.ratingUpdateTimeSeconds || (entry.contestDate ? Math.floor(new Date(entry.contestDate).getTime() / 1000) : Math.floor(Date.now() / 1000));
    startTime = new Date(startSec * 1000);
    duration = 7200; // Codeforces rounds are usually 2 hours
    contestStatus = 'Rated';
    contestType = 'Weekly';
    const match = title.match(/Round\s+(\d+)/i) || title.match(/(\d+)/);
    contestNumber = match ? parseInt(match[1], 10) : 0;
  }

  // Check if slug already exists
  const existing = await db.query("SELECT contest_id, title, slug, start_time FROM Contests WHERE slug = ?", [slug]);
  if (existing.length > 0) {
    return existing[0];
  }

  // Insert new contest
  const result = await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [title, slug, contestType, contestNumber, startTime, duration, contestStatus, platform === 'leetcode' ? 'LeetCode' : platform === 'codechef' ? 'CodeChef' : 'Codeforces', 'SYNC']);

  return {
    contest_id: result.insertId,
    title,
    slug,
    start_time: startTime
  };
}

async function syncStudentPlatform(userId, platform, forceSync = false) {
  const plat = platform.toLowerCase();

  const start = Date.now();

  // 1. Fetch user handle details
  const users = await db.query(
    `SELECT id, name, leetcode_username, codechef_username, codeforces_username, hackerrank_username FROM Users WHERE id = ?`,
    [userId]
  );
  if (users.length === 0) throw new Error('Student not found');
  const user = users[0];
  const username = user[`${plat}_username`];

  if (!username || !username.trim()) {
    // Platform disconnected, ensure sync state is removed
    await db.query(`DELETE FROM StudentPlatformSync WHERE user_id = ? AND platform = ?`, [userId, plat]);
    return { skipped: true, reason: 'Username not configured' };
  }

  // 2. Fetch existing sync state
  const syncStateRows = await db.query(
    `SELECT sync_status, last_successful_sync, last_attempt, retry_count, next_retry FROM StudentPlatformSync WHERE user_id = ? AND platform = ?`,
    [userId, plat]
  );
  const state = syncStateRows[0] || null;

  if (state && !forceSync) {
    const now = new Date();
    // Skip if recently synced (last 10 minutes) and healthy/partial
    if ((state.sync_status === 'Healthy' || state.sync_status === 'Partial') && state.last_successful_sync) {
      const diffMs = now - new Date(state.last_successful_sync);
      if (diffMs < 10 * 60 * 1000) { // 10 minutes TTL
        const logger = require('./logger');
        logger.debug(`[Sync] Skipping external API call for ${plat} for user ${userId}. Recently synced ${Math.round(diffMs / 1000 / 60)}m ago.`);
        return { skipped: true, reason: 'Recently synced within TTL', lastSuccessfulSync: state.last_successful_sync };
      }
    }
    // Skip if failed and next_retry is in the future
    if (state.sync_status === 'Failed' && state.next_retry) {
      if (now < new Date(state.next_retry)) {
        return { skipped: true, reason: 'Retry backoff active', nextRetry: state.next_retry };
      }
    }
  }

  // Log Sync Started
  await auditLogSvc.log(auditLogSvc.AUDIT_ACTIONS.SYNC_STARTED, {
    actor: 'SYSTEM',
    targetType: 'student_platform_sync',
    targetId: `${userId}:${plat}`,
    details: { studentId: userId, studentName: user.name, platform: plat, username, action: 'SYNC_STARTED' }
  });

  let rawData = null;
  let syncError = null;
  let failureCategory = null;
  let profileResult = null;

  try {
    // 3. Fetch from remote API via trackCall (using platform adapters)
    const { getAdapter } = require('../services/adapters/AdapterFactory');
    const adapter = getAdapter(plat);
    profileResult = await platformHealthSvc.trackCall(plat, () => adapter.getProfile(username));
    rawData = profileResult.rawData;
    
    // Validate Sync Data structure
    const valRes = await validationSvc.validateSyncData(plat, rawData, username);
    if (!valRes.valid) {
      throw new Error(`Data validation failed: ${valRes.error}`);
    }
  } catch (err) {
    syncError = err;
    const msg = err.message || String(err);
    // Categorize failure
    if (msg.includes('not found') || msg.includes('404') || msg.includes('does not exist') || msg.includes('invalid username')) {
      failureCategory = 'invalid_username';
    } else if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Too Many Requests')) {
      failureCategory = 'rate_limiting';
    } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('timed out')) {
      failureCategory = 'timeout';
    } else if (msg.includes('503') || msg.includes('502') || msg.includes('504') || msg.includes('unavailable') || msg.includes('connect ECONNREFUSED')) {
      failureCategory = 'api_unavailable';
    } else if (msg.includes('Parsing') || msg.includes('JSON') || msg.includes('validation failed')) {
      failureCategory = 'parsing_failure';
    } else if (msg.includes('Database') || msg.includes('query') || msg.includes('SQL')) {
      failureCategory = 'database_write_failure';
    } else {
      failureCategory = 'unknown';
    }
  }

  const executionTimeMs = Date.now() - start;

  if (syncError) {
    // 4. Handle failure & schedule retry
    const currentRetries = state ? state.retry_count : 0;
    const newRetries = failureCategory === 'invalid_username' ? 0 : currentRetries + 1;
    
    let nextRetry = null;
    if (failureCategory !== 'invalid_username' && newRetries <= 5) {
      const delayMin = Math.pow(2, newRetries) * 5;
      nextRetry = new Date(Date.now() + delayMin * 60 * 1000);
    }

    // Save sync state
    await db.query(`
      INSERT INTO StudentPlatformSync (user_id, platform, username, sync_status, last_attempt, retry_count, failure_reason, failure_category, next_retry, data_completeness)
      VALUES (?, ?, ?, 'Failed', NOW(), ?, ?, ?, ?, 0)
      ON DUPLICATE KEY UPDATE
        username = VALUES(username),
        sync_status = 'Failed',
        last_attempt = NOW(),
        retry_count = VALUES(retry_count),
        failure_reason = VALUES(failure_reason),
        failure_category = VALUES(failure_category),
        next_retry = VALUES(next_retry),
        data_completeness = 0
    `, [userId, plat, username, newRetries, syncError.message, failureCategory, nextRetry]);

    // Structured Failure Audit Log
    await auditLogSvc.log(auditLogSvc.AUDIT_ACTIONS.SYNC_FAILED, {
      actor: 'SYSTEM',
      targetType: 'student_platform_sync',
      targetId: `${userId}:${plat}`,
      details: {
        studentId: userId,
        studentName: user.name,
        platform: plat,
        username,
        executionTimeMs,
        status: 'Failed',
        errorCategory: failureCategory,
        errorMessage: syncError.message,
        nextRetryScheduled: nextRetry
      },
      severity: 'ERROR'
    });

    return { success: false, category: failureCategory, error: syncError.message };
  }

  // 5. Handle success & evaluate completeness
  const completeness = validationSvc.evaluateCompleteness(plat, rawData);
  const syncStatus = completeness.complete ? 'Healthy' : 'Partial';
  const failureReason = completeness.complete ? null : `Missing fields: ${completeness.missing.join(', ')}`;

  // Normalize
  const profile = profileResult;

  // Contest Matching & Auto-Attendance
  if (Array.isArray(rawData.contestHistory)) {
    for (const entry of rawData.contestHistory) {
      const dbContest = await ensureContestInDb(plat, entry);
      if (dbContest) {
        await db.query(
          "INSERT IGNORE INTO Registrations (user_id, contest_id) VALUES (?, ?)",
          [userId, dbContest.contest_id]
        );
        await db.query(
          `INSERT INTO ParticipationLogs (user_id, contest_id, join_time, participation_status)
           VALUES (?, ?, CURRENT_TIMESTAMP, 'JOINED')
           ON DUPLICATE KEY UPDATE join_time = VALUES(join_time)`,
          [userId, dbContest.contest_id]
        );

        let rank = null;
        let score = null;
        let oldRatingVal = null;
        let newRatingVal = null;
        let ratingChangeVal = null;

        if (plat === 'leetcode') {
          rank = entry.ranking || null;
          score = entry.problemsSolved || null;
          newRatingVal = entry.rating ? Math.round(entry.rating) : null;
          if (entry.rating && entry.oldRating) {
            oldRatingVal = Math.round(entry.oldRating);
            ratingChangeVal = newRatingVal - oldRatingVal;
          }
        } else if (plat === 'codechef') {
          rank = entry.rank || null;
          newRatingVal = entry.newRating || null;
          oldRatingVal = entry.oldRating || null;
          ratingChangeVal = entry.ratingChange || 0;
        } else if (plat === 'codeforces') {
          rank = entry.rank || null;
          newRatingVal = entry.newRating || null;
          oldRatingVal = entry.oldRating || null;
          ratingChangeVal = (entry.newRating && entry.oldRating) ? (entry.newRating - entry.oldRating) : 0;
        }

        await db.query(`
          INSERT INTO AttendanceRecords (user_id, contest_id, contest_name, contest_slug, contest_date, attendance_status, attendance_source, \`rank\`, score, rating_before, rating_after, rating_change, participated)
          VALUES (?, ?, ?, ?, ?, 'PRESENT', 'AUTO', ?, ?, ?, ?, ?, 1)
          ON DUPLICATE KEY UPDATE
            attendance_status = 'PRESENT',
            attendance_source = 'AUTO',
            \`rank\` = VALUES(\`rank\`),
            score = VALUES(score),
            rating_before = VALUES(rating_before),
            rating_after = VALUES(rating_after),
            rating_change = VALUES(rating_change),
            participated = 1
        `, [userId, dbContest.contest_id, dbContest.title, dbContest.slug, dbContest.start_time, rank, score, oldRatingVal, newRatingVal, ratingChangeVal]);
      }
    }
  }

  // Fetch current rating first to detect changes
  let oldRating = null;
  if (plat === 'leetcode') {
    const rows = await db.query("SELECT current_rating FROM LeetCodeProfiles WHERE user_id = ?", [userId]);
    oldRating = rows[0]?.current_rating || 1500;
  } else if (plat === 'codechef') {
    const rows = await db.query("SELECT current_rating FROM CodeChefProfiles WHERE user_id = ?", [userId]);
    oldRating = rows[0]?.current_rating || 0;
  } else if (plat === 'codeforces') {
    const rows = await db.query("SELECT current_rating FROM CodeforcesProfiles WHERE user_id = ?", [userId]);
    oldRating = rows[0]?.current_rating || 0;
  }

  await auditLogSvc.log('DATABASE_WRITE', {
    actor: 'SYSTEM',
    targetType: 'student_platform_sync',
    targetId: `${userId}:${plat}`,
    details: { platform: plat, username, action: 'SAVE_PROFILE_DATA' }
  });

  // Write profile database record
  if (plat === 'leetcode') {
    console.log('[Sync Diagnostics] Saving LeetCodeProfile to DB. User ID:', userId);

    await db.query(`
      INSERT INTO LeetCodeProfiles (user_id, current_rating, highest_rating, global_ranking, problems_solved, contest_history, active_days, submission_calendar, badges, language_stats, topic_stats, recent_submissions, easy_solved, medium_solved, hard_solved, acceptance_rate, last_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        current_rating = VALUES(current_rating),
        highest_rating = VALUES(highest_rating),
        global_ranking = VALUES(global_ranking),
        problems_solved = VALUES(problems_solved),
        contest_history = VALUES(contest_history),
        active_days = VALUES(active_days),
        submission_calendar = VALUES(submission_calendar),
        badges = VALUES(badges),
        language_stats = VALUES(language_stats),
        topic_stats = VALUES(topic_stats),
        recent_submissions = VALUES(recent_submissions),
        easy_solved = VALUES(easy_solved),
        medium_solved = VALUES(medium_solved),
        hard_solved = VALUES(hard_solved),
        acceptance_rate = VALUES(acceptance_rate),
        last_synced = NOW()
    `, [
      userId,
      profile.rating || 1500,
      profile.maxRating || profile.rating || 1500,
      profile.rank || null,
      profile.problemsSolved || 0,
      JSON.stringify(rawData.contestHistory || []),
      profile.metadata?.activeDays || 0,
      JSON.stringify(rawData.submissionCalendar || {}),
      JSON.stringify(rawData.badges || []),
      JSON.stringify(rawData.languageStats || []),
      JSON.stringify(rawData.topicStats || []),
      JSON.stringify(rawData.recentSubmissions || []),
      profile.metadata?.easySolved || 0,
      profile.metadata?.mediumSolved || 0,
      profile.metadata?.hardSolved || 0,
      rawData.acceptanceRate || null
    ]);

    const afterSave = await db.query(
      "SELECT user_id, problems_solved FROM LeetCodeProfiles WHERE user_id = ?",
      [userId]
    );
    console.log('[Sync] LeetCode profile saved for user', userId, '| problems_solved:', afterSave[0]?.problems_solved);
  } else if (plat === 'codechef') {
    const ratingHistory = rawData.ratingHistory || [];
    console.log('[AUDIT][DB SAVE] currentRating =', profile.rating, 'highestRating =', profile.maxRating, 'lowestRating =', profile.lowestRating, 'ratingHistory.length =', ratingHistory.length);
    console.log('[AUDIT LOG][Database Save] currentRating =', profile.rating);
    await db.query(`
      INSERT INTO CodeChefProfiles (user_id, current_rating, highest_rating, lowest_rating, is_provisional, status, global_ranking, country_rank, problems_solved, stars, contest_history, rating_history, last_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        current_rating = COALESCE(VALUES(current_rating), current_rating),
        highest_rating = COALESCE(VALUES(highest_rating), highest_rating),
        lowest_rating = COALESCE(VALUES(lowest_rating), lowest_rating),
        is_provisional = COALESCE(VALUES(is_provisional), is_provisional),
        status = COALESCE(VALUES(status), status),
        global_ranking = COALESCE(VALUES(global_ranking), global_ranking),
        country_rank = COALESCE(VALUES(country_rank), country_rank),
        problems_solved = GREATEST(COALESCE(VALUES(problems_solved), 0), COALESCE(problems_solved, 0)),
        stars = COALESCE(VALUES(stars), stars),
        contest_history = COALESCE(VALUES(contest_history), contest_history),
        rating_history = COALESCE(VALUES(rating_history), rating_history),
        last_synced = NOW()
    `, [
      userId,
      profile.rating,
      profile.maxRating,
      profile.lowestRating,
      profile.isProvisional ? 1 : 0,
      profile.status || 'UNRATED',
      profile.rank || null,
      profile.countryRank || null,
      profile.problemsSolved || 0,
      profile.stars || null,
      rawData.contestHistory ? JSON.stringify(rawData.contestHistory) : null,
      ratingHistory ? JSON.stringify(ratingHistory) : null
    ]);
  } else if (plat === 'codeforces') {
    await db.query(`
      INSERT INTO CodeforcesProfiles (user_id, current_rating, highest_rating, \`rank\`, max_rank, problems_solved, contest_history, last_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        current_rating = VALUES(current_rating),
        highest_rating = VALUES(highest_rating),
        \`rank\` = VALUES(\`rank\`),
        max_rank = VALUES(max_rank),
        problems_solved = VALUES(problems_solved),
        contest_history = VALUES(contest_history),
        last_synced = NOW()
    `, [userId, profile.rating || 0, profile.maxRating || profile.rating || 0, profile.rank || null, profile.metadata?.maxRank || null, profile.problemsSolved || 0, JSON.stringify(rawData.contestHistory || [])]);
  } else if (plat === 'hackerrank') {
    await db.query(`
      INSERT INTO HackerRankProfiles (user_id, badges, stars, certificates, problems_solved, last_synced)
      VALUES (?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        badges = VALUES(badges),
        stars = VALUES(stars),
        certificates = VALUES(certificates),
        problems_solved = VALUES(problems_solved),
        last_synced = NOW()
    `, [userId, JSON.stringify(profile.badges || []), profile.metadata?.stars || 0, JSON.stringify(profile.metadata?.certificates || []), profile.problemsSolved || 0]);
  }

  // Check and notify for significant rating changes
  if (oldRating !== null && profile.rating) {
    await notificationSvc.checkAndNotifyRatingChange(userId, user.name, plat, oldRating, profile.rating);
  }

  // Save successful sync state
  await db.query(`
    INSERT INTO StudentPlatformSync (user_id, platform, username, sync_status, last_successful_sync, last_attempt, retry_count, failure_reason, failure_category, next_retry, data_completeness)
    VALUES (?, ?, ?, ?, NOW(), NOW(), 0, ?, NULL, NULL, ?)
    ON DUPLICATE KEY UPDATE
      username = VALUES(username),
      sync_status = VALUES(sync_status),
      last_successful_sync = NOW(),
      last_attempt = NOW(),
      retry_count = 0,
      failure_reason = VALUES(failure_reason),
      failure_category = NULL,
      next_retry = NULL,
      data_completeness = VALUES(data_completeness)
  `, [userId, plat, username, syncStatus, failureReason, completeness.score]);

  // Structured Success Audit Log
  await auditLogSvc.log(auditLogSvc.AUDIT_ACTIONS.PROFILE_SYNCED, {
    actor: 'SYSTEM',
    targetType: 'student_platform_sync',
    targetId: `${userId}:${plat}`,
    details: {
      studentId: userId,
      studentName: user.name,
      platform: plat,
      username,
      executionTimeMs,
      status: syncStatus,
      completenessScore: completeness.score,
      missingFields: completeness.missing
    }
  });

  // Invalidate cache keys
  cache.invalidate(cache.KEYS.STUDENT_ANALYTICS(userId));
  cache.invalidate(cache.KEYS.PLACEMENT_STUDENT(userId));
  cache.invalidate(cache.KEYS.AI_INSIGHTS(userId));
  cache.invalidatePrefix(cache.KEYS.PLACEMENT_OVERVIEW(''));
  cache.invalidatePrefix(cache.KEYS.LEADERBOARDS(''));
  cache.invalidate(cache.KEYS.PORTAL_SUMMARY);

  return { success: true, status: syncStatus, completenessScore: completeness.score };
}

async function syncStudentProfiles(userId) {
  const logger = require('./logger');
  logger.info(`[Sync] Triggering manual live synchronization for user ID: ${userId}...`);
  const platforms = Object.keys(connectors);
  const results = await Promise.allSettled(platforms.map(platform => syncStudentPlatform(userId, platform, true)));
  
  let updated = false;
  results.forEach((res, idx) => {
    if (res.status === 'fulfilled') {
      const val = res.value;
      if (val && !val.skipped) {
        updated = true;
      }
    } else {
      logger.error(`[Sync Failure] Platform: ${platforms[idx]} | Error:`, res.reason);
    }
  });
  return { updated };
}

module.exports = {
  syncAllData,
  seedMasterContests,
  initScheduler,
  formatDate,
  ensureContestInDb,
  syncStudentProfiles,
  syncStudentPlatform
};

