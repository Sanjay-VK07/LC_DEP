const db = require('../config/db');

async function runCleanup() {
  console.log('[Cleanup] Starting production database cleanup of invalid/mock/test contests...');
  
  let connection;
  try {
    await db.initializeDatabase();
    const pool = db.getPool();
    connection = await pool.getConnection();

    // Begin Transaction
    await connection.beginTransaction();
    console.log('[Cleanup] Database transaction started.');

    // 1. Identify invalid contests from Contests table
    // Criteria:
    // - Title or slug contains: starting, test, dummy, mock, demo, sample, practice, initial, development, placeholder, crashed, upcoming-live, retry, stale
    // - Or slug is null, empty, or malformed (e.g. not starting with weekly-contest, biweekly-contest, codechef-, codeforces-, hackerrank- in production)
    const invalidKeywords = [
      '%starting%', '%test%', '%dummy%', '%mock%', '%demo%', '%sample%', 
      '%practice%', '%initial%', '%development%', '%placeholder%', 
      '%crashed%', '%upcoming-live%', '%retry%', '%stale%'
    ];

    const searchConditions = [];
    const searchParams = [];
    
    // Add title / slug keyword conditions
    invalidKeywords.forEach(kw => {
      searchConditions.push('title LIKE ?');
      searchParams.push(kw);
      searchConditions.push('slug LIKE ?');
      searchParams.push(kw);
    });

    // Add empty/null conditions
    searchConditions.push('slug IS NULL');
    searchConditions.push('slug = ""');
    searchConditions.push('start_time IS NULL');

    const selectQuery = `
      SELECT contest_id, title, slug, platform 
      FROM Contests 
      WHERE ${searchConditions.join(' OR ')}
    `;

    const invalidContests = await connection.query(selectQuery, searchParams).then(r => r[0]);
    console.log(`[Cleanup] Found ${invalidContests.length} invalid contest(s) in Contests table.`);

    // 2. Identify invalid contests in LiveContests table
    const liveSearchConditions = [];
    const liveSearchParams = [];
    
    invalidKeywords.forEach(kw => {
      liveSearchConditions.push('contestName LIKE ?');
      liveSearchParams.push(kw);
      liveSearchConditions.push('contestSlug LIKE ?');
      liveSearchParams.push(kw);
    });
    
    liveSearchConditions.push('contestSlug IS NULL');
    liveSearchConditions.push('contestSlug = ""');

    const selectLiveQuery = `
      SELECT id, contestName, contestSlug, platform 
      FROM LiveContests 
      WHERE ${liveSearchConditions.join(' OR ')}
    `;

    const invalidLiveContests = await connection.query(selectLiveQuery, liveSearchParams).then(r => r[0]);
    console.log(`[Cleanup] Found ${invalidLiveContests.length} invalid contest(s) in LiveContests table.`);

    // Collect all unique slugs and IDs
    const contestIds = Array.from(new Set(invalidContests.map(c => c.contest_id).filter(Boolean)));
    const contestSlugs = Array.from(new Set([
      ...invalidContests.map(c => c.slug).filter(Boolean),
      ...invalidLiveContests.map(c => c.contestSlug).filter(Boolean)
    ]));
    const liveContestIds = Array.from(new Set(invalidLiveContests.map(c => c.id).filter(Boolean)));

    // Also verify if there are any Contests/LiveContests referencing the same slugs/IDs cross-wise
    if (contestSlugs.length > 0) {
      const placeholders = contestSlugs.map(() => '?').join(',');
      const crossContests = await connection.query(`SELECT contest_id FROM Contests WHERE slug IN (${placeholders})`, contestSlugs).then(r => r[0]);
      crossContests.forEach(c => contestIds.push(c.contest_id));
      
      const crossLive = await connection.query(`SELECT id FROM LiveContests WHERE contestSlug IN (${placeholders})`, contestSlugs).then(r => r[0]);
      crossLive.forEach(c => liveContestIds.push(c.id));
    }

    const uniqueContestIds = Array.from(new Set(contestIds));
    const uniqueContestSlugs = Array.from(new Set(contestSlugs));
    const uniqueLiveContestIds = Array.from(new Set(liveContestIds));

    console.log(`[Cleanup] Total unique contest_ids to purge: ${uniqueContestIds.length}`);
    console.log(`[Cleanup] Total unique contest slugs to purge: ${uniqueContestSlugs.length}`);
    console.log(`[Cleanup] Total unique LiveContest IDs to purge: ${uniqueLiveContestIds.length}`);

    const report = {
      Contests: 0,
      LiveContests: 0,
      ContestParticipants: 0,
      Contest_Participants: 0,
      ContestAttendance: 0,
      Contest_Attendance: 0,
      AttendanceRecords: 0,
      ContestLeaderboardSnapshots: 0,
      ContestSnapshots: 0,
      Registrations: 0,
      ParticipationLogs: 0,
      ContestSyncLog: 0
    };

    // Helper function to execute delete with list of values
    const executeDelete = async (table, column, values) => {
      if (!values || values.length === 0) return 0;
      const placeholders = values.map(() => '?').join(',');
      const query = `DELETE FROM ${table} WHERE \`${column}\` IN (${placeholders})`;
      const result = await connection.query(query, values).then(r => r[0]);
      return result.affectedRows || 0;
    };

    // Disable foreign key checks temporarily to clean up everything safely
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    // Delete related records
    if (uniqueContestSlugs.length > 0) {
      report.ContestParticipants = await executeDelete('ContestParticipants', 'contest_slug', uniqueContestSlugs);
      report.Contest_Participants = await executeDelete('Contest_Participants', 'contest_slug', uniqueContestSlugs);
      report.Contest_Attendance = await executeDelete('Contest_Attendance', 'contest_slug', uniqueContestSlugs);
      
      try {
        report.ContestLeaderboardSnapshots = await executeDelete('ContestLeaderboardSnapshots', 'contest_slug', uniqueContestSlugs);
      } catch (e) {
        console.log(`[Cleanup] Table ContestLeaderboardSnapshots delete skipped or not present: ${e.message}`);
      }

      try {
        report.ContestSyncLog = await executeDelete('ContestSyncLog', 'contest_slug', uniqueContestSlugs);
      } catch (e) {
        // Table might not exist or be named differently
      }
    }

    if (uniqueContestIds.length > 0) {
      report.AttendanceRecords = await executeDelete('AttendanceRecords', 'contest_id', uniqueContestIds);
      report.Registrations = await executeDelete('Registrations', 'contest_id', uniqueContestIds);
      report.ParticipationLogs = await executeDelete('ParticipationLogs', 'contest_id', uniqueContestIds);
      report.Contests = await executeDelete('Contests', 'contest_id', uniqueContestIds);
    }

    if (uniqueLiveContestIds.length > 0) {
      report.ContestAttendance = await executeDelete('ContestAttendance', 'contestId', uniqueLiveContestIds);
      
      try {
        report.ContestSnapshots = await executeDelete('ContestSnapshots', 'contestId', uniqueLiveContestIds);
      } catch (e) {
        console.log(`[Cleanup] Table ContestSnapshots delete skipped: ${e.message}`);
      }

      try {
        await executeDelete('ContestSyncLog', 'contestId', uniqueLiveContestIds);
      } catch (e) {}

      report.LiveContests = await executeDelete('LiveContests', 'id', uniqueLiveContestIds);
    }

    // Re-enable foreign key checks
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    // Commit Transaction
    await connection.commit();
    console.log('[Cleanup] Transaction committed successfully.');
    console.log('[Cleanup] Summary of purged records:', report);

    return { success: true, report, invalidContests };
  } catch (err) {
    if (connection) {
      await connection.rollback();
      console.error('[Cleanup] Transaction rolled back due to error:', err.message);
    }
    throw err;
  } finally {
    if (connection) connection.release();
    const pool = db.getPool();
    if (pool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  runCleanup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Cleanup] Fatal cleanup error:', err);
      process.exit(1);
    });
}

module.exports = { runCleanup };
