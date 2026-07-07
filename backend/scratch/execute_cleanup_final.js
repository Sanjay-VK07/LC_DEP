const db = require('../config/db');
const cache = require('../services/analyticsCacheService');

async function run() {
  await db.initializeDatabase();

  console.log('=== STARTING DATABASE CLEANUP AUDIT ===');

  // 1. Identify Target Contests from LiveContests
  const targetLive = await db.query(`
    SELECT id, contestSlug, contestName, platform 
    FROM LiveContests 
    WHERE contestSlug LIKE 'test-%'
       OR contestSlug LIKE 'crashed-%'
       OR contestSlug LIKE 'retry-%'
       OR contestSlug LIKE 'upcoming-%'
       OR contestSlug LIKE 'stale-%'
       OR contestSlug LIKE 'fail-%'
       OR contestSlug LIKE 'demo-%'
  `);

  // 2. Identify Target Contests from Contests
  const targetC = await db.query(`
    SELECT contest_id, title, slug, platform 
    FROM Contests 
    WHERE slug LIKE 'test-%'
       OR slug LIKE 'crashed-%'
       OR slug LIKE 'retry-%'
       OR slug LIKE 'upcoming-%'
       OR slug LIKE 'stale-%'
       OR slug LIKE 'fail-%'
       OR slug LIKE 'demo-%'
  `);

  console.log(`Found ${targetLive.length} target test contests in LiveContests.`);
  console.log(`Found ${targetC.length} target test contests in Contests.`);

  if (targetLive.length === 0 && targetC.length === 0) {
    console.log('No test contest records found. Database is clean!');
    process.exit(0);
  }

  // 3. Prepare Report on dependencies
  const liveIds = targetLive.map(r => r.id);
  const liveSlugs = targetLive.map(r => r.contestSlug);
  const cIds = targetC.map(r => r.contest_id);
  const cSlugs = targetC.map(r => r.slug);

  let linkedLiveAttendance = 0;
  let linkedLiveParticipants = 0;
  let linkedLiveSnapshots = 0;
  let linkedLiveLogs = 0;
  let linkedAttendanceRecords = 0;
  let linkedRegistrations = 0;
  let linkedContestParticipants = 0;

  if (liveIds.length > 0) {
    const [att] = await db.query(`SELECT COUNT(*) as count FROM ContestAttendance WHERE contestId IN (${liveIds.join(',')})`);
    linkedLiveAttendance = att.count;

    const [logs] = await db.query(`SELECT COUNT(*) as count FROM ContestSyncLog WHERE contestId IN (${liveIds.join(',')})`);
    linkedLiveLogs = logs.count;
  }

  // Use parameterized placeholders or escape properly for slug list queries
  if (liveSlugs.length > 0) {
    const placeholders = liveSlugs.map(() => '?').join(',');
    const [parts] = await db.query(`SELECT COUNT(*) as count FROM ContestParticipants WHERE contest_slug IN (${placeholders})`, liveSlugs);
    linkedLiveParticipants = parts.count;

    const [snaps] = await db.query(`SELECT COUNT(*) as count FROM ContestLeaderboardSnapshots WHERE contest_slug IN (${placeholders})`, liveSlugs);
    linkedLiveSnapshots = snaps.count;
  }

  if (cIds.length > 0) {
    const [attRecs] = await db.query(`SELECT COUNT(*) as count FROM AttendanceRecords WHERE contest_id IN (${cIds.join(',')})`);
    linkedAttendanceRecords = attRecs.count;

    const [regs] = await db.query(`SELECT COUNT(*) as count FROM Registrations WHERE contest_id IN (${cIds.join(',')})`);
    linkedRegistrations = regs.count;
  }

  if (cSlugs.length > 0) {
    const placeholders = cSlugs.map(() => '?').join(',');
    const [ccParts] = await db.query(`SELECT COUNT(*) as count FROM Contest_Participants WHERE contest_slug IN (${placeholders})`, cSlugs);
    linkedContestParticipants = ccParts.count;
  }

  console.log('\n=== AUDIT REPORT ===');
  console.log('Target LiveContests IDs Count:', liveIds.length);
  console.log('Target Contests IDs Count:', cIds.length);
  console.log('Linked ContestAttendance Rows to Delete:', linkedLiveAttendance);
  console.log('Linked ContestParticipants Rows to Delete:', linkedLiveParticipants);
  console.log('Linked ContestLeaderboardSnapshots Rows to Delete:', linkedLiveSnapshots);
  console.log('Linked ContestSyncLog Rows to Delete:', linkedLiveLogs);
  console.log('Linked AttendanceRecords Rows to Delete:', linkedAttendanceRecords);
  console.log('Linked Registrations Rows to Delete:', linkedRegistrations);
  console.log('Linked Contest_Participants Rows to Delete:', linkedContestParticipants);

  console.log('\n=== EXECUTING CASCADE CLEANUP ===');

  // Deletions from dependent tables
  if (liveIds.length > 0) {
    const deleteAtt = await db.query(`DELETE FROM ContestAttendance WHERE contestId IN (${liveIds.join(',')})`);
    console.log(`Deleted ${deleteAtt.affectedRows} rows from ContestAttendance.`);

    const deleteLogs = await db.query(`DELETE FROM ContestSyncLog WHERE contestId IN (${liveIds.join(',')})`);
    console.log(`Deleted ${deleteLogs.affectedRows} rows from ContestSyncLog.`);
  }

  if (liveSlugs.length > 0) {
    const placeholders = liveSlugs.map(() => '?').join(',');
    const deleteParts = await db.query(`DELETE FROM ContestParticipants WHERE contest_slug IN (${placeholders})`, liveSlugs);
    console.log(`Deleted ${deleteParts.affectedRows} rows from ContestParticipants.`);

    const deleteSnaps = await db.query(`DELETE FROM ContestLeaderboardSnapshots WHERE contest_slug IN (${placeholders})`, liveSlugs);
    console.log(`Deleted ${deleteSnaps.affectedRows} rows from ContestLeaderboardSnapshots.`);
  }

  if (cIds.length > 0) {
    const deleteAttRecs = await db.query(`DELETE FROM AttendanceRecords WHERE contest_id IN (${cIds.join(',')})`);
    console.log(`Deleted ${deleteAttRecs.affectedRows} rows from AttendanceRecords.`);

    const deleteRegs = await db.query(`DELETE FROM Registrations WHERE contest_id IN (${cIds.join(',')})`);
    console.log(`Deleted ${deleteRegs.affectedRows} rows from Registrations.`);
  }

  if (cSlugs.length > 0) {
    const placeholders = cSlugs.map(() => '?').join(',');
    const deleteCcParts = await db.query(`DELETE FROM Contest_Participants WHERE contest_slug IN (${placeholders})`, cSlugs);
    console.log(`Deleted ${deleteCcParts.affectedRows} rows from Contest_Participants.`);
  }

  // Deletions from primary tables
  if (liveIds.length > 0) {
    const deleteLive = await db.query(`DELETE FROM LiveContests WHERE id IN (${liveIds.join(',')})`);
    console.log(`Deleted ${deleteLive.affectedRows} rows from LiveContests.`);
  }

  if (cIds.length > 0) {
    const deleteC = await db.query(`DELETE FROM Contests WHERE contest_id IN (${cIds.join(',')})`);
    console.log(`Deleted ${deleteC.affectedRows} rows from Contests.`);
  }

  console.log('\n=== REFRESHING METRICS AND CACHE ===');
  // Check if Contest_Summary table exists
  const tables = await db.query("SHOW TABLES LIKE 'Contest_Summary'");
  if (tables.length > 0) {
    console.log('Recalculating Contest_Summary...');
    await db.query(`
      UPDATE Contest_Summary cs
      SET 
        total_contests = (SELECT COUNT(*) FROM AttendanceRecords ar WHERE ar.user_id = cs.student_id),
        rated_contests = (SELECT COUNT(*) FROM AttendanceRecords ar WHERE ar.user_id = cs.student_id AND ar.contest_status = 'RATED'),
        unrated_contests = (SELECT COUNT(*) FROM AttendanceRecords ar WHERE ar.user_id = cs.student_id AND ar.contest_status = 'UNRATED')
    `);
    console.log('Contest_Summary recalculated.');
  } else {
    console.log('Contest_Summary table does not exist (obsolete). Skipping.');
  }

  cache.invalidateAll();
  console.log('Analytics cache successfully refreshed.');

  console.log('\n=== DATABASE HEALTH VERIFICATION ===');
  const [cCountAfter] = await db.query('SELECT COUNT(*) as count FROM Contests');
  const [lcCountAfter] = await db.query('SELECT COUNT(*) as count FROM LiveContests');
  console.log('Remaining Contests in Contests:', cCountAfter.count);
  console.log('Remaining Contests in LiveContests:', lcCountAfter.count);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
