const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const NetworkService = require('../utils/networkService');
const LeetCodeRankingSearchService = require('../services/leetcodeRankingSearchService');
const LeetCodeContestAttendanceController = require('../controllers/leetcodeContestAttendanceController');

// Stub helper to backup/restore NetworkService.request
let originalRequest = NetworkService.request;

test('LeetCode Ranking Sync - Matching, Backoff, and Database Upserts', async (t) => {
  try {
    // Ensure database is initialized
    await db.initializeDatabase();
    await db.query("SELECT 1");

    // Drop and recreate contest_attendance specifically for this test to ensure column freshness
    await db.query("DROP TABLE IF EXISTS contest_attendance");
    await db.query(`
      CREATE TABLE contest_attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contest_slug VARCHAR(255) NOT NULL,
        student_id INT NOT NULL,
        leetcode_username VARCHAR(255) NOT NULL,
        attendance ENUM('PRESENT', 'ABSENT') NOT NULL,
        \`rank\` INT DEFAULT NULL,
        score DECIMAL(10,2) DEFAULT NULL,
        finish_time INT DEFAULT NULL,
        synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_student_contest_slug_idx (student_id, contest_slug),
        FOREIGN KEY (student_id) REFERENCES Users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    // Ensure department exists
    await db.query("INSERT IGNORE INTO departments (name, code) VALUES ('Computer Science', 'CSE')");

    // 1. Create a dummy student for the test
    const testRollNo = 'TESTROLL_RANKSEARCH_123';
    const testUsername = '  Test_Scraper_User  '; // spaces and mixed casing
    const normalizedTestUsername = 'test_scraper_user';

    // Cleanup old test data
    await db.query("DELETE FROM AttendanceRecords WHERE user_id IN (SELECT id FROM Users WHERE roll_no = ? OR leetcode_username = ?)", [testRollNo, testUsername]);
    await db.query("DELETE FROM contest_attendance WHERE student_id IN (SELECT id FROM Users WHERE roll_no = ? OR leetcode_username = ?)", [testRollNo, testUsername]);
    await db.query("DELETE FROM Users WHERE roll_no = ? OR leetcode_username = ?", [testRollNo, testUsername]);

    // Insert mock student
    const insertRes = await db.query(`
      INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), 'active')
    `, ['Test Scraper Student', testRollNo, 'CSE', 'TEST_SEC_A', testUsername, '2024-2028']);
    const studentId = insertRes.insertId;

    const activeUsers = await db.query("SELECT id, roll_no, leetcode_username, status FROM Users WHERE status = 'active'");
    console.log("ACTIVE_USERS_IN_TEST:", JSON.stringify(activeUsers));

    // Mock NetworkService.request
    NetworkService.request = async (url, options) => {
      // If pagination = 1
      if (url.includes('pagination=1')) {
        return {
          user_num: 50, // 2 pages total
          total_rank: [
            { username: 'other_user1', rank: 1, score: 20, finish_time: 123456 },
            { username: 'other_user2', rank: 2, score: 18, finish_time: 123457 }
          ]
        };
      }
      // If pagination = 2 (contains our matching student)
      if (url.includes('pagination=2')) {
        return {
          user_num: 50,
          total_rank: [
            { username: 'test_scraper_user', rank: 26, score: 12, finish_time: 123459 },
            { username: 'other_user3', rank: 27, score: 10, finish_time: 123460 }
          ]
        };
      }
      return { user_num: 0, total_rank: [] };
    };

    // 2. Test Concurrency Guard
    const contestSlug = 'test-ranking-search-contest-99';
    
    // Start first sync
    const syncPromise = LeetCodeRankingSearchService.syncContestAttendance(contestSlug);
    
    // Try to start second sync immediately (should throw error)
    await assert.rejects(
      LeetCodeRankingSearchService.syncContestAttendance(contestSlug),
      /already running/
    );

    // Wait for the first sync to complete
    const result = await syncPromise;

    // Assertions on result metrics
    assert.ok(result.success);
    assert.strictEqual(result.totalParticipants, 50);

    // 3. Verify Database Upserts
    // Check contest_attendance table
    const caRecord = await db.query(
      "SELECT * FROM contest_attendance WHERE student_id = ? AND contest_slug = ?",
      [studentId, contestSlug]
    );
    assert.strictEqual(caRecord.length, 1);
    assert.strictEqual(caRecord[0].attendance, 'PRESENT');
    assert.strictEqual(caRecord[0].rank, 26);
    assert.strictEqual(Math.round(caRecord[0].score), 12);
    assert.strictEqual(caRecord[0].finish_time, 123459);

    // Check AttendanceRecords table
    const arRecord = await db.query(
      `SELECT ar.* FROM AttendanceRecords ar 
       JOIN Contests c ON ar.contest_id = c.contest_id 
       WHERE ar.user_id = ? AND c.slug = ?`,
      [studentId, contestSlug]
    );
    assert.strictEqual(arRecord.length, 1);
    assert.strictEqual(arRecord[0].attendance_status, 'PRESENT');
    assert.strictEqual(arRecord[0].attendance_source, 'AUTO');
    assert.strictEqual(arRecord[0].rank, 26);
    assert.strictEqual(Math.round(arRecord[0].score), 12);

    // 4. Test Controller Layer
    // Test getStatsAndRecords with mock Express response
    let responseData = null;
    const mockReq = {
      query: {
        contestSlug,
        department: 'CSE',
        batch: '2024-2028',
        section: 'TEST_SEC_A'
      }
    };
    const mockRes = {
      statusCode: 200,
      json(data) {
        responseData = data;
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      }
    };

    await LeetCodeContestAttendanceController.getStatsAndRecords(mockReq, mockRes);
    
    console.log("RESPONSE_DATA:", JSON.stringify(responseData));
    assert.ok(responseData);
    assert.strictEqual(responseData.success, true);
    assert.ok(responseData.stats);
    assert.strictEqual(responseData.stats.present, 1);
    assert.strictEqual(responseData.stats.attendancePercentage, 100);
    assert.strictEqual(responseData.records.length, 1);
    assert.strictEqual(responseData.records[0].leetcode_username, testUsername);

    // 5. Test Overwriting & ABSENT Marking
    // Modify mock to simulate student leaving the contest ranking
    NetworkService.request = async (url, options) => {
      return {
        user_num: 1,
        total_rank: [
          { username: 'other_user1', rank: 1, score: 20, finish_time: 123456 }
        ]
      };
    };

    const reResult = await LeetCodeRankingSearchService.syncContestAttendance(contestSlug);
    assert.ok(reResult.success);

    // Assert that student is now marked ABSENT
    const caRecordAbsent = await db.query(
      "SELECT * FROM contest_attendance WHERE student_id = ? AND contest_slug = ?",
      [studentId, contestSlug]
    );
    assert.strictEqual(caRecordAbsent[0].attendance, 'ABSENT');
    assert.strictEqual(caRecordAbsent[0].rank, null);
    assert.strictEqual(caRecordAbsent[0].finish_time, null);

    const arRecordAbsent = await db.query(
      `SELECT ar.* FROM AttendanceRecords ar 
       JOIN Contests c ON ar.contest_id = c.contest_id 
       WHERE ar.user_id = ? AND c.slug = ?`,
      [studentId, contestSlug]
    );
    assert.strictEqual(arRecordAbsent[0].attendance_status, 'ABSENT');

    // Clean up
    await db.query("DELETE FROM AttendanceRecords WHERE user_id = ?", [studentId]);
    await db.query("DELETE FROM contest_attendance WHERE student_id = ?", [studentId]);
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
    await db.query("DELETE FROM Contests WHERE slug = ?", [contestSlug]);

    console.log("ALL INTEGRATION TESTS PASSED!");
  } catch (err) {
    console.error("TEST_ERROR_STACK:", err);
    throw err;
  } finally {
    NetworkService.request = originalRequest;
    await db.closePool();
  }
});
