const db = require('../config/db');

async function run() {
  try {
    await db.initializeDatabase();
    console.log('[Migration] Starting cleanup of fake contests...');

    // 1. Identify fake contests from Contests table
    let fakeContests = [];
    try {
      fakeContests = await db.query(`
        SELECT contest_id, slug, title FROM Contests
        WHERE slug = 'weekly-contest-999' OR title LIKE '%999%' OR contest_number = 999
      `);
    } catch (err) {
      console.warn('[Migration] Error querying Contests table:', err.message);
    }
    const fakeContestIds = fakeContests.map(c => c.contest_id);
    const fakeSlugs = fakeContests.map(c => c.slug);
    console.log(`[Migration] Found ${fakeContests.length} fake contests in Contests table.`, fakeContests);

    // 2. Identify fake contests from LiveContests table
    let fakeLiveContests = [];
    try {
      fakeLiveContests = await db.query(`
        SELECT id, contestSlug, contestName FROM LiveContests
        WHERE contestSlug = 'weekly-contest-999' OR contestName LIKE '%999%'
      `);
    } catch (err) {
      console.warn('[Migration] Error querying LiveContests table:', err.message);
    }
    const fakeLiveContestIds = fakeLiveContests.map(c => c.id);
    const fakeLiveSlugs = fakeLiveContests.map(c => c.contestSlug);
    console.log(`[Migration] Found ${fakeLiveContests.length} fake contests in LiveContests table.`, fakeLiveContests);

    // Combine all slugs to clean
    const allSlugs = [...new Set(['weekly-contest-999', ...fakeSlugs, ...fakeLiveSlugs])];

    // Helper function to safely execute delete queries
    const safeDelete = async (table, queryStr, params) => {
      try {
        const res = await db.query(queryStr, params);
        console.log(`[Migration] Cleaned up "${table}" table successfully.`);
        return res;
      } catch (err) {
        console.warn(`[Migration] Table "${table}" cleanup skipped or failed:`, err.message);
      }
    };

    // 3. Delete from tables matching contestId (LiveContests foreign key)
    if (fakeLiveContestIds.length > 0) {
      const placeholders = fakeLiveContestIds.map(() => '?').join(',');
      await safeDelete('ContestSnapshots', `DELETE FROM ContestSnapshots WHERE contestId IN (${placeholders})`, fakeLiveContestIds);
      await safeDelete('ContestAttendance', `DELETE FROM ContestAttendance WHERE contestId IN (${placeholders})`, fakeLiveContestIds);
      await safeDelete('ContestSyncLog', `DELETE FROM ContestSyncLog WHERE contestId IN (${placeholders})`, fakeLiveContestIds);
    }

    // 4. Delete from tables matching contest_slug
    if (allSlugs.length > 0) {
      const placeholders = allSlugs.map(() => '?').join(',');
      await safeDelete('ContestParticipants', `DELETE FROM ContestParticipants WHERE contest_slug IN (${placeholders})`, allSlugs);
      await safeDelete('Contest_Participants', `DELETE FROM Contest_Participants WHERE contest_slug IN (${placeholders})`, allSlugs);
      await safeDelete('contest_attendance', `DELETE FROM contest_attendance WHERE contest_slug IN (${placeholders})`, allSlugs);
      await safeDelete('Contest_Attendance', `DELETE FROM Contest_Attendance WHERE contest_slug IN (${placeholders})`, allSlugs);
      await safeDelete('ContestLeaderboardSnapshots', `DELETE FROM ContestLeaderboardSnapshots WHERE contest_slug IN (${placeholders})`, allSlugs);
      await safeDelete('AttendanceRecords', `DELETE FROM AttendanceRecords WHERE contest_slug IN (${placeholders})`, allSlugs);
      await safeDelete('ContestSyncLog', `DELETE FROM ContestSyncLog WHERE contest_slug IN (${placeholders})`, allSlugs);
    }

    // 5. Delete from tables matching contest_id (Contests foreign key)
    if (fakeContestIds.length > 0) {
      const placeholders = fakeContestIds.map(() => '?').join(',');
      await safeDelete('AttendanceRecords', `DELETE FROM AttendanceRecords WHERE contest_id IN (${placeholders})`, fakeContestIds);
      await safeDelete('ParticipationLogs', `DELETE FROM ParticipationLogs WHERE contest_id IN (${placeholders})`, fakeContestIds);
      await safeDelete('Registrations', `DELETE FROM Registrations WHERE contest_id IN (${placeholders})`, fakeContestIds);
      await safeDelete('notifications', `DELETE FROM notifications WHERE contest_id IN (${placeholders})`, fakeContestIds);
    }

    // 6. Delete from main Contests and LiveContests tables
    if (fakeContestIds.length > 0) {
      const placeholders = fakeContestIds.map(() => '?').join(',');
      await safeDelete('Contests', `DELETE FROM Contests WHERE contest_id IN (${placeholders})`, fakeContestIds);
    }
    // Just in case slug was not mapped to ID
    await safeDelete('Contests', `
      DELETE FROM Contests 
      WHERE slug = 'weekly-contest-999' OR title LIKE '%999%' OR contest_number = 999
    `);

    if (fakeLiveContestIds.length > 0) {
      const placeholders = fakeLiveContestIds.map(() => '?').join(',');
      await safeDelete('LiveContests', `DELETE FROM LiveContests WHERE id IN (${placeholders})`, fakeLiveContestIds);
    }
    await safeDelete('LiveContests', `
      DELETE FROM LiveContests 
      WHERE contestSlug = 'weekly-contest-999' OR contestName LIKE '%999%'
    `);

    // 7. Cleanup orphaned rows (foreign keys that might not have ON DELETE CASCADE or need manual delete)
    console.log('[Migration] Cleaning up orphaned records...');
    await safeDelete('AttendanceRecords', `
      DELETE FROM AttendanceRecords 
      WHERE contest_id NOT IN (SELECT contest_id FROM Contests)
    `);
    await safeDelete('ParticipationLogs', `
      DELETE FROM ParticipationLogs 
      WHERE contest_id NOT IN (SELECT contest_id FROM Contests)
    `);
    await safeDelete('Registrations', `
      DELETE FROM Registrations 
      WHERE contest_id NOT IN (SELECT contest_id FROM Contests)
    `);
    await safeDelete('ContestAttendance', `
      DELETE FROM ContestAttendance 
      WHERE contestId NOT IN (SELECT id FROM LiveContests)
    `);
    await safeDelete('ContestSnapshots', `
      DELETE FROM ContestSnapshots 
      WHERE contestId NOT IN (SELECT id FROM LiveContests)
    `);

    // 8. Clean up contest history stored in LeetCodeProfiles, CodeChefProfiles, CodeforcesProfiles JSON
    const profileTables = ['LeetCodeProfiles', 'CodeChefProfiles', 'CodeforcesProfiles'];
    for (const table of profileTables) {
      try {
        const profiles = await db.query(`SELECT id, user_id, contest_history FROM ${table} WHERE contest_history IS NOT NULL`);
        for (const p of profiles) {
          let history = [];
          try {
            history = typeof p.contest_history === 'string' ? JSON.parse(p.contest_history) : p.contest_history;
          } catch (e) {
            continue;
          }
          if (Array.isArray(history)) {
            const originalLength = history.length;
            const cleanedHistory = history.filter(h => {
              const slug = h.contestSlug || h.contest_slug || (h.contest && (h.contest.titleSlug || h.contest.title)) || '';
              const title = h.contestName || (h.contest && h.contest.title) || '';
              const isFake = slug === 'weekly-contest-999' || slug.includes('999') || title.includes('999');
              return !isFake;
            });
            if (cleanedHistory.length !== originalLength) {
              console.log(`[Migration] Cleaning history for student ID ${p.user_id} in table ${table}. Filtered out ${originalLength - cleanedHistory.length} fake entries.`);
              await db.query(`UPDATE ${table} SET contest_history = ? WHERE id = ?`, [JSON.stringify(cleanedHistory), p.id]);
            }
          }
        }
      } catch (err) {
        console.warn(`[Migration] Failed to clean contest_history in table ${table}:`, err.message);
      }
    }

    // 9. Clear analytics cache
    const cache = require('../services/analyticsCacheService');
    if (cache && typeof cache.clearAll === 'function') {
      await cache.clearAll();
      console.log('[Migration] Cleared all analytics caches.');
    }

    console.log('[Migration] Database cleanup migration completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('[Migration] Migration failed:', error);
    process.exit(1);
  }
}

run();
