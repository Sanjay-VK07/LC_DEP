/**
 * test_phase2_weekly515_local.js
 * ==============================
 * Local test for Phase 2 Contest Activity Tracker on Weekly Contest 515.
 */

const path = require('path');
const db = require(path.join(__dirname, '../backend/config/db'));
const ContestActivityService = require(path.join(__dirname, '../backend/services/ContestActivityService'));
const ContestActivityScheduler = require(path.join(__dirname, '../backend/services/ContestActivityScheduler'));

async function runLocalTest() {
  await db.initializeDatabase();

  console.log('=== LOCAL TEST: CONTEST ACTIVITY TRACKER PHASE 2 (WEEKLY CONTEST 515) ===\n');

  const contestSlug = 'weekly-contest-515';

  // Clear previous activity snapshots for weekly-contest-515 to test fresh run
  await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);

  console.log('--- RUN 1: FRESH POLL FROM CLIST API ---');
  const run1 = await ContestActivityService.recordActivity(contestSlug, { bypassCache: true });
  console.log('Run 1 Summary:', {
    actualParticipantCount: run1.actualParticipantCount,
    matchedCount: run1.matchedCount,
    newSnapshotsCreated: run1.newSnapshotsCreated,
    duplicateSnapshotsSkipped: run1.duplicateSnapshotsSkipped
  });

  const ganesh1 = run1.matchedObservations.find(o => o.norm_handle === 'ganeshkumar2006');
  console.log('Ganeshkumar2006 Run 1 Observation:', ganesh1);

  console.log('\n--- RUN 2: REPEAT POLL (DUPLICATE PREVENTION TEST) ---');
  const run2 = await ContestActivityService.recordActivity(contestSlug, { bypassCache: false });
  console.log('Run 2 Summary:', {
    actualParticipantCount: run2.actualParticipantCount,
    matchedCount: run2.matchedCount,
    newSnapshotsCreated: run2.newSnapshotsCreated,
    duplicateSnapshotsSkipped: run2.duplicateSnapshotsSkipped
  });

  console.log('\n======================================================');
  console.log('  PHASE 2 LOCAL TEST VERIFICATION RESULT');
  console.log('======================================================');
  console.log(`Actual CLIST Participants : ${run1.actualParticipantCount} (Expected: 823)`);
  console.log(`Local Matches             : ${run1.matchedCount} (Expected: 9)`);
  console.log(`Ganeshkumar2006 Found     : ${ganesh1 ? 'YES' : 'NO'}`);
  console.log(`Ganeshkumar2006 Rank      : ${ganesh1 ? ganesh1.rank : 'N/A'} (Expected: 393)`);
  console.log(`Ganeshkumar2006 Score     : ${ganesh1 ? ganesh1.score : 'N/A'} (Expected: 18)`);
  console.log(`Run 1 Snapshots Created   : ${run1.newSnapshotsCreated} (Expected: 9)`);
  console.log(`Run 2 Duplicate Skipped   : ${run2.duplicateSnapshotsSkipped} (Expected: 9)`);
  console.log(`Run 2 New Snapshots       : ${run2.newSnapshotsCreated} (Expected: 0)`);
  console.log('======================================================\n');

  process.exit(0);
}

runLocalTest().catch(err => {
  console.error('Local test error:', err);
  process.exit(1);
});
