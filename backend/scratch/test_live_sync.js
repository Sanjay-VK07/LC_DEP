const db = require('../config/db');
const contestmasterController = require('../controllers/contestmasterController');
const EventBus = require('../services/EventBus');
const studentSyncQueue = require('../services/studentSyncQueue');
const snapshotEngine = require('../services/snapshotEngine');

// Setup mock res object
const makeRes = (resolve, reject) => ({
  status(code) {
    console.log(`[HTTP Response Status]: ${code}`);
    return this;
  },
  json(data) {
    console.log(`[HTTP Response JSON]:`, JSON.stringify(data, null, 2));
    resolve(data);
  }
});

async function run() {
  await db.initializeDatabase();

  const contestSlug = 'weekly-contest-999';

  // 1. Prepare weekly-contest-999 to be Live and reset its data
  console.log(`--- Preparing ${contestSlug} to be Live ---`);
  await db.query(
    "UPDATE LiveContests SET status = 'Live', syncProgress = 0.00 WHERE contestSlug = ?",
    [contestSlug]
  );
  
  const rows = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [contestSlug]);
  if (rows.length === 0) {
    console.error(`${contestSlug} not found in LiveContests table`);
    process.exit(1);
  }
  const contestId = rows[0].id;
  console.log(`Contest ID is: ${contestId}`);

  // Delete previous attendance rows for this contest to ensure a clean test
  await db.query("DELETE FROM ContestAttendance WHERE contestId = ?", [contestId]);

  // Listen to all relevant EventBus events
  EventBus.on('SyncStarted', (p) => console.log('=== EventBus: SyncStarted ===', p));
  EventBus.on('SyncProgress', (p) => console.log('=== EventBus: SyncProgress ===', p));
  EventBus.on('StudentUpdated', (p) => console.log('=== EventBus: StudentUpdated ===', p));
  EventBus.on('ContestCompleted', (p) => console.log('=== EventBus: ContestCompleted ===', p));

  console.log(`--- Triggering Live Sync for contest ${contestSlug} ---`);

  // Call the controller method
  const responseData = await new Promise((resolve, reject) => {
    contestmasterController.triggerLiveControl(
      { body: { action: 'sync', contestId } },
      makeRes(resolve, reject)
    ).catch(reject);
  });

  // Since it should fallback to standingsProvider and complete instantly, let's wait 5 seconds.
  console.log('Waiting for studentSyncQueue execution...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('=== Verification of DB results ===');
  const attendance = await db.query(
    "SELECT studentId, username, attendanceStatus, `rank`, solved, score FROM ContestAttendance WHERE contestId = ?",
    [contestId]
  );
  console.log('ContestAttendance rows in DB:', attendance);

  const liveContest = await db.query(
    "SELECT syncProgress, status FROM LiveContests WHERE id = ?",
    [contestId]
  );
  console.log('LiveContest progress in DB:', liveContest);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
