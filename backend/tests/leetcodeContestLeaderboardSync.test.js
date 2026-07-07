const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const NetworkService = require('../utils/networkService');
const ContestLeaderboardSyncService = require('../services/ContestLeaderboardSyncService');

before(async () => {
  await db.initializeDatabase();
});

after(async () => {
  if (db.getPool()) {
    await db.getPool().end();
  }
});

test('ContestLeaderboardSync - successful sync from page 1', async (t) => {
  // Clear cooldown state
  ContestLeaderboardSyncService.cooldownUntil = null;
  ContestLeaderboardSyncService.cooldownReason = null;
  
  const originalRequest = NetworkService.request;
  const contestSlug = `test-leaderboard-success-${Date.now()}`;
  
  // Setup mock user in batch '2024-28'
  const regNo = `REG-LB-${Date.now()}`;
  await db.query(`
    INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
    VALUES ('Ganesh LB User', ?, 'DEC', 'A', 'ganesh_lb_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')
  `, [regNo]);

  let requestCount = 0;
  NetworkService.request = async (url, options) => {
    requestCount++;
    const pageMatch = url.match(/pagination=(\d+)/);
    const page = pageMatch ? parseInt(pageMatch[1], 10) : 1;
    
    if (page === 1) {
      return {
        user_num: 35,
        total_rank: [
          { username: 'ganesh_lb_user', rank: 5, score: 10.00, finish_time: 1600 }
        ]
      };
    } else if (page === 2) {
      return {
        user_num: 35,
        total_rank: [
          { username: 'other_user', rank: 30, score: 5.00, finish_time: 2000 }
        ]
      };
    }
    return { user_num: 35, total_rank: [] };
  };

  try {
    const stats = await ContestLeaderboardSyncService.syncContest(contestSlug, {
      batch: '2024-28',
      forceSync: true
    });
    
    assert.strictEqual(stats.success, true);
    assert.strictEqual(stats.pagesFetched, 2);
    assert.strictEqual(stats.participants, 2);

    // Verify database sync logs
    const [log] = await db.query(
      "SELECT sync_status, last_page_synced, errors FROM ContestSyncLog WHERE contest_slug = ? ORDER BY started_at DESC LIMIT 1",
      [contestSlug]
    );
    assert.strictEqual(log.sync_status, 'COMPLETED');
    assert.strictEqual(log.last_page_synced, 2);
    assert.strictEqual(log.errors, null);

  } finally {
    NetworkService.request = originalRequest;
    // Cleanup
    await db.query("DELETE FROM ContestParticipants WHERE contest_slug = ?", [contestSlug]);
    await db.query("DELETE FROM ContestLeaderboardSnapshots WHERE contest_slug = ?", [contestSlug]);
    await db.query("DELETE FROM ContestAttendance WHERE contestId IN (SELECT id FROM LiveContests WHERE contestSlug = ?)", [contestSlug]);
    await db.query("DELETE FROM AttendanceRecords WHERE contest_slug = ?", [contestSlug]);
    await db.query("DELETE FROM LiveContests WHERE contestSlug = ?", [contestSlug]);
    await db.query("DELETE FROM Contests WHERE slug = ?", [contestSlug]);
    await db.query("DELETE FROM Users WHERE roll_no = ?", [regNo]);
  }
});

test('ContestLeaderboardSync - Cloudflare block triggers circuit breaker and suspends next syncs', async (t) => {
  ContestLeaderboardSyncService.cooldownUntil = null;
  ContestLeaderboardSyncService.cooldownReason = null;
  
  const originalRequest = NetworkService.request;
  const contestSlug = `test-leaderboard-cf-${Date.now()}`;
  
  let cfRequestAttempts = 0;
  NetworkService.request = async (url, options) => {
    cfRequestAttempts++;
    throw new NetworkService.CloudflareBlockedError('Cloudflare anti-bot verification challenge');
  };

  try {
    // Attempt sync
    await assert.rejects(
      ContestLeaderboardSyncService.syncContest(contestSlug, {
        batch: '2024-28',
        forceSync: true
      }),
      (err) => {
        return err.name === 'CloudflareBlockedError';
      }
    );

    // Check database sync logs is set to RATE_LIMITED
    const [log] = await db.query(
      "SELECT sync_status, errors FROM ContestSyncLog WHERE contest_slug = ? ORDER BY started_at DESC LIMIT 1",
      [contestSlug]
    );
    assert.strictEqual(log.sync_status, 'RATE_LIMITED');
    const parsedErrors = JSON.parse(log.errors);
    assert.ok(parsedErrors.timestamp);
    assert.ok(parsedErrors.retryAfter);
    assert.strictEqual(parsedErrors.reason, 'Cloudflare anti-bot verification challenge');

    // Confirm that in-memory cooldown is set
    assert.ok(ContestLeaderboardSyncService.cooldownUntil);
    assert.strictEqual(ContestLeaderboardSyncService.cooldownReason, 'Cloudflare anti-bot verification challenge');

    // Attempt second sync immediately during cooldown; it must be suspended
    await assert.rejects(
      ContestLeaderboardSyncService.syncContest(contestSlug, {
        batch: '2024-28'
      }),
      (err) => {
        return err.message.includes('suspended due to Cloudflare cooldown') && err.statusCode === 429;
      }
    );

  } finally {
    NetworkService.request = originalRequest;
    ContestLeaderboardSyncService.cooldownUntil = null;
    ContestLeaderboardSyncService.cooldownReason = null;
    await db.query("DELETE FROM ContestSyncLog WHERE contest_slug = ?", [contestSlug]);
    await db.query("DELETE FROM LiveContests WHERE contestSlug = ?", [contestSlug]);
    await db.query("DELETE FROM Contests WHERE slug = ?", [contestSlug]);
  }
});

test('ContestLeaderboardSync - Invalid contest slug fails immediately without retrying', async (t) => {
  ContestLeaderboardSyncService.cooldownUntil = null;
  ContestLeaderboardSyncService.cooldownReason = null;

  const originalRequest = NetworkService.request;
  const contestSlug = `test-leaderboard-invalid-${Date.now()}`;

  let requestAttempts = 0;
  NetworkService.request = async (url, options) => {
    requestAttempts++;
    const err = new Error('Not Found');
    err.status = 404;
    throw err;
  };

  try {
    await assert.rejects(
      ContestLeaderboardSyncService.syncContest(contestSlug, {
        batch: '2024-28',
        forceSync: true
      }),
      (err) => {
        return err.status === 404;
      }
    );

    // Should only have attempted 1 request, no retry backoffs for 404
    assert.strictEqual(requestAttempts, 1);

    // Sync log must be FAILED (not RATE_LIMITED)
    const [log] = await db.query(
      "SELECT sync_status, errors FROM ContestSyncLog WHERE contest_slug = ? ORDER BY started_at DESC LIMIT 1",
      [contestSlug]
    );
    assert.strictEqual(log.sync_status, 'FAILED');
    assert.strictEqual(log.errors, 'Not Found');
  } finally {
    NetworkService.request = originalRequest;
    await db.query("DELETE FROM ContestSyncLog WHERE contest_slug = ?", [contestSlug]);
    await db.query("DELETE FROM LiveContests WHERE contestSlug = ?", [contestSlug]);
    await db.query("DELETE FROM Contests WHERE slug = ?", [contestSlug]);
  }
});
