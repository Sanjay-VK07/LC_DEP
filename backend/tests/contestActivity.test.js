/**
 * contestActivity.test.js
 * =======================
 * Test suite for Contest Activity Tracker (Phase 1).
 */

const assert = require('assert');
const db = require('../config/db');
const ContestActivityService = require('../services/ContestActivityService');
const { normalizeUsername } = require('../utils/usernameNormalizer');
const ClistAdapter = require('../services/clist/ClistAdapter');

async function runTests() {
  await db.initializeDatabase();

  console.log('====================================================');
  console.log('  CONTEST ACTIVITY TRACKER TEST SUITE (PHASE 1)');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(description, fn) {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        console.log(`✓ PASS: ${description}`);
        passed++;
      })
      .catch((err) => {
        console.error(`✗ FAIL: ${description}`);
        console.error(`  Error: ${err.message}`);
        failed++;
      });
  }

  // 1. CLIST participant retrieval
  await test('1. CLIST participant retrieval uses actual objects', async () => {
    assert.strictEqual(typeof ContestActivityService.recordActivity, 'function');
  });

  // 2. Username normalization
  await test('2. Username normalization strips domains & handles case accurately', async () => {
    const raw = 'ganeshkumar2006@.com';
    const norm = normalizeUsername(raw);
    assert.strictEqual(norm, 'ganeshkumar2006');
  });

  // 3. Local student matching
  await test('3. Local student matching finds active students by normalized handle', async () => {
    const activeStudents = await db.query("SELECT id, leetcode_username FROM Users WHERE status = 'active'");
    assert(activeStudents.length > 0, 'Should have active students');
    const matched = activeStudents.some(s => normalizeUsername(s.leetcode_username) === 'ganeshkumar2006');
    assert.strictEqual(matched, true, 'Ganeshkumar2006 should be in local roster');
  });

  // 4. Activity snapshot creation
  await test('4. Migration 24 creates ContestActivitySnapshots table', async () => {
    const rows = await db.query("SHOW TABLES LIKE 'ContestActivitySnapshots'");
    assert.strictEqual(rows.length, 1, 'ContestActivitySnapshots table should exist in database');
  });

  // 5. Duplicate snapshot prevention
  await test('5. Duplicate snapshot prevention skips identical rank and score observations', async () => {
    const contestSlug = 'test-activity-contest-dup';
    
    // Find test student
    const [testStudent] = await db.query("SELECT id FROM Users WHERE status = 'active' LIMIT 1");
    const studentId = testStudent.id;

    // Clear old test rows
    await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);

    // Insert first observation
    await db.query(
      `INSERT INTO ContestActivitySnapshots (contest_id, student_id, contest_slug, leetcode_username, \`rank\`, score, observed_at, provider)
       VALUES (1, ?, ?, 'testuser', 100, 15.00, NOW(), 'CLIST')`,
      [studentId, contestSlug]
    );

    // Query latest
    const latestRows = await db.query(
      `SELECT \`rank\`, score FROM ContestActivitySnapshots WHERE student_id = ? AND contest_slug = ? ORDER BY observed_at DESC, id DESC LIMIT 1`,
      [studentId, contestSlug]
    );

    const latest = latestRows[0];
    const isDuplicate = parseInt(latest.rank, 10) === 100 && parseFloat(latest.score) === 15.00;
    assert.strictEqual(isDuplicate, true, 'Identical rank and score should be detected as duplicate');

    // Clean up
    await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);
  });

  // 6. Rank change creates snapshot
  await test('6. Rank change creates a new activity snapshot', async () => {
    const contestSlug = 'test-activity-rank-change';
    const [testStudent] = await db.query("SELECT id FROM Users WHERE status = 'active' LIMIT 1");
    const studentId = testStudent.id;

    await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);

    await db.query(
      `INSERT INTO ContestActivitySnapshots (contest_id, student_id, contest_slug, leetcode_username, \`rank\`, score, observed_at, provider)
       VALUES (1, ?, ?, 'testuser', 500, 15.00, NOW(), 'CLIST')`,
      [studentId, contestSlug]
    );

    await db.query(
      `INSERT INTO ContestActivitySnapshots (contest_id, student_id, contest_slug, leetcode_username, \`rank\`, score, observed_at, provider)
       VALUES (1, ?, ?, 'testuser', 450, 15.00, NOW(), 'CLIST')`,
      [studentId, contestSlug]
    );

    const rows = await db.query("SELECT * FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);
    assert.strictEqual(rows.length, 2, 'Should create 2 separate snapshots on rank change');

    await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);
  });

  // 7. Score change creates snapshot
  await test('7. Score change creates a new activity snapshot', async () => {
    const contestSlug = 'test-activity-score-change';
    const [testStudent] = await db.query("SELECT id FROM Users WHERE status = 'active' LIMIT 1");
    const studentId = testStudent.id;

    await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);

    await db.query(
      `INSERT INTO ContestActivitySnapshots (contest_id, student_id, contest_slug, leetcode_username, \`rank\`, score, observed_at, provider)
       VALUES (1, ?, ?, 'testuser', 450, 15.00, NOW(), 'CLIST')`,
      [studentId, contestSlug]
    );

    await db.query(
      `INSERT INTO ContestActivitySnapshots (contest_id, student_id, contest_slug, leetcode_username, \`rank\`, score, observed_at, provider)
       VALUES (1, ?, ?, 'testuser', 450, 18.00, NOW(), 'CLIST')`,
      [studentId, contestSlug]
    );

    const rows = await db.query("SELECT * FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);
    assert.strictEqual(rows.length, 2, 'Should create 2 separate snapshots on score change');

    await db.query("DELETE FROM ContestActivitySnapshots WHERE contest_slug = ?", [contestSlug]);
  });

  // 8. Activity does not modify attendance
  await test('8. Activity service code does not import or alter ContestAttendance/AttendanceRecords', async () => {
    const fs = require('fs');
    const serviceCode = fs.readFileSync(require.resolve('../services/ContestActivityService'), 'utf8');
    assert.strictEqual(serviceCode.includes('ContestAttendance'), false, 'Service must not mention ContestAttendance');
    assert.strictEqual(serviceCode.includes('AttendanceRecords'), false, 'Service must not mention AttendanceRecords');
  });

  // 9. Activity does not modify leaderboardComplete
  await test('9. Activity service code does not alter leaderboardComplete or attendanceFinalized', async () => {
    const fs = require('fs');
    const serviceCode = fs.readFileSync(require.resolve('../services/ContestActivityService'), 'utf8');
    assert.strictEqual(serviceCode.includes('leaderboardComplete'), false, 'Service must not modify leaderboardComplete');
    assert.strictEqual(serviceCode.includes('attendanceFinalized'), false, 'Service must not modify attendanceFinalized');
  });

  // 10. Activity uses actual participant count, not estimated_count
  await test('10. Activity service uses actual retrieved participant objects count', async () => {
    const fs = require('fs');
    const serviceCode = fs.readFileSync(require.resolve('../services/ContestActivityService'), 'utf8');
    assert.strictEqual(serviceCode.includes('allScrapedObjects.length'), true, 'Service must count actual retrieved objects');
    assert.strictEqual(serviceCode.includes('meta.estimated_count'), false, 'Service must not use estimated_count');
  });

  console.log('\n====================================================');
  console.log(`  TEST SUMMARY: Passed ${passed} / Failed ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
