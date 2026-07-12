const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');

// Import Milestone 4 services
const startupRecovery = require('../services/startupRecovery');
const liveContestScheduler = require('../services/liveContestScheduler');
const EventBus = require('../services/EventBus');
const controller = require('../controllers/contestmasterController');

test('StartupRecovery - recovers crashed live contests and finalizes them', async () => {
  await db.initializeDatabase();

  const slug = `crashed-contest-${Date.now()}`;
  // 1. Seed a contest that ended in the past but is stuck in 'Live' status
  await db.query(`
    INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
    VALUES ('LeetCode', ?, 'Stuck Contest', 'Weekly', DATE_SUB(NOW(), INTERVAL 2 HOUR), DATE_SUB(NOW(), INTERVAL 1 HOUR), 'Live')
  `, [slug]);

  const [contest] = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
  const contestId = contest.id;

  // 2. Seed a student attendance record as participating
  const activeStudents = await db.query("SELECT id FROM Users WHERE status = 'active' LIMIT 1");
  const studentId = activeStudents[0].id;

  await db.query(`
    INSERT INTO ContestAttendance (contestId, studentId, username, attendanceStatus, solved, score)
    VALUES (?, ?, 'ganesh_stuck', 'Participating', 2, 7.0)
  `, [contestId, studentId]);

  // 3. Run startup recovery checks
  await startupRecovery.run();

  // 4. Verify contest is completed
  const [recovered] = await db.query("SELECT status FROM LiveContests WHERE id = ?", [contestId]);
  assert.equal(recovered.status, 'Completed');

  // 5. Verify student status is finalized to 'Present' (since they participated)
  const [attendance] = await db.query("SELECT attendanceStatus FROM ContestAttendance WHERE contestId = ? AND studentId = ?", [contestId, studentId]);
  assert.equal(attendance.attendanceStatus, 'Present');
});

test('LiveContestScheduler - processes live check sweeps', async () => {
  const slug = `upcoming-live-${Date.now()}`;
  
  // Clean up any existing live contests in DB to prevent cross-test sync overlaps
  await db.query("UPDATE LiveContests SET status = 'Completed'");

  // 1. Seed an upcoming contest whose start time is past (meaning it should transition to Live)
  await db.query(`
    INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, duration, contest_status, platform, source)
    VALUES ('Starting Contest', ?, 'Weekly', 103, DATE_SUB(NOW(), INTERVAL 10 SECOND), 3600, 'RATED', 'LeetCode', 'SYNC')
  `, [slug]);

  await db.query(`
    INSERT INTO LiveContests (platform, contestSlug, contestName, contestType, startTime, endTime, status)
    VALUES ('LeetCode', ?, 'Starting Contest', 'Weekly', DATE_SUB(NOW(), INTERVAL 10 SECOND), DATE_ADD(NOW(), INTERVAL 1 HOUR), 'Upcoming')
  `, [slug]);

  const [contest] = await db.query("SELECT id FROM LiveContests WHERE contestSlug = ?", [slug]);
  const contestId = contest.id;

  // Set up promise to wait for the background sync to finish completely
  const syncFinished = new Promise((resolve) => {
    EventBus.once('ContestCompleted', (payload) => {
      if (payload.contestId === contestId) {
        resolve();
      }
    });
  });

  // 2. Perform live sweeps check (which triggers background sync)
  await liveContestScheduler._checkLiveContests();

  // Wait for the sync queue to complete
  await syncFinished;

  // 3. Verify it is promoted to Live
  const [updated] = await db.query("SELECT status FROM LiveContests WHERE id = ?", [contestId]);
  assert.equal(updated.status, 'Live');

  // Clean up scheduler background loop just in case it started
  liveContestScheduler.stop();
});

test('SSE Controller - getLiveStream broadcasts updates and handles cleanup', async () => {
  let headersSet = false;
  let responseData = '';
  let closedCallback = null;

  const req = {
    on: (event, cb) => {
      if (event === 'close') {
        closedCallback = cb;
      }
    }
  };

  const res = {
    setHeader: (name, val) => {
      headersSet = true;
    },
    flushHeaders: () => {},
    write: (data) => {
      responseData += data;
    }
  };

  // 1. Call controller method
  await controller.getLiveStream(req, res);

  assert.equal(headersSet, true);
  assert.ok(responseData.includes('"connected": true'));

  // Count active event listeners on EventBus
  const initialListeners = EventBus.listenerCount('StudentUpdated');

  // 2. Dispatch simulated StudentUpdated event
  EventBus.emit('StudentUpdated', {
    contestId: 1,
    studentId: 1007,
    username: 'test_user',
    diff: { rank: 25 }
  });

  // Verify responseData contains the SSE message structure
  assert.ok(responseData.includes('event: StudentUpdated'));
  assert.ok(responseData.includes('"username":"test_user"'));

  // 3. Simulate client disconnect closing request
  if (closedCallback) {
    closedCallback();
  }

  // Active listeners must decrement back to initial count
  const remainingListeners = EventBus.listenerCount('StudentUpdated');
  assert.equal(remainingListeners, initialListeners - 1);
});

after(async () => {
  try {
    await db.query("DELETE FROM Contests WHERE slug LIKE 'upcoming-live-%'");
    await db.query("DELETE FROM LiveContests WHERE contestSlug LIKE 'upcoming-live-%'");
  } catch (err) {
    console.error('Test cleanup failed:', err);
  }
  const pool = db.getPool();
  if (pool) {
    await pool.end();
  }
  // Force exit to clean up keep-alive network sockets
  process.exit(0);
});
