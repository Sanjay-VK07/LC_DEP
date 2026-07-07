const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const studentController = require('../controllers/studentController');

test('DataHealthAudit - detects duplicates, invalid records, missing fields, and calculates health scores', async () => {
  await db.initializeDatabase();

  const originalQuery = db.query;

  // Mock DB query to return fake duplicate and incomplete rows
  db.query = async function(sql, params) {
    if (sql.includes("FROM Users") && sql.includes("status = 'active'")) {
      return [
        { id: 9901, name: 'Student A Healthy', roll_no: 'ROLL-A-111', department: 'DEC', section: 'A', academic_batch: '2024-2028', leetcode_username: 'lc_a', codeforces_username: 'cf_a', codechef_username: 'cc_a', hackerrank_username: 'hr_a' },
        { id: 9902, name: 'Student B Duplicate Roll', roll_no: 'ROLL-A-111', department: 'DEC', section: 'B', academic_batch: '2024-2028', leetcode_username: 'lc_b', codeforces_username: 'cf_b', codechef_username: 'cc_b', hackerrank_username: 'hr_b' },
        { id: 9903, name: 'Student C Incomplete', roll_no: 'ROLL-C-111', department: 'DEC', section: '', academic_batch: '2024-2028', leetcode_username: 'lc_c', codeforces_username: 'cf_c', codechef_username: 'cc_c', hackerrank_username: 'hr_c' }
      ];
    }
    if (sql.includes("FROM LeetCodeProfiles")) {
      return [
        { user_id: 9901, current_rating: 1500, problems_solved: 50, last_synced: new Date() }
        // 9902 and 9903 have never synced
      ];
    }
    if (sql.includes("FROM CodeforcesProfiles") || sql.includes("FROM HackerRankProfiles") || sql.includes("FROM CodeChefProfiles")) {
      return [];
    }
    if (sql.includes("FROM StudentPlatformSync")) {
      return [
        { user_id: 9901, platform: 'leetcode', username: 'lc_a', sync_status: 'Healthy', last_successful_sync: new Date(), last_attempt: new Date(), retry_count: 0, failure_reason: null, failure_category: null, data_completeness: 100, next_retry: null }
      ];
    }
    if (sql.includes("FROM departments")) {
      return [{ code: 'DEC' }];
    }
    return originalQuery.call(db, sql, params);
  };

  try {
    // 2. Invoke controller method with mock Express response
    let responseData = null;
    const mockReq = {};
    const mockRes = {
      json(data) {
        responseData = data;
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      }
    };

    await studentController.getStudentsDataHealth(mockReq, mockRes);

    assert.ok(responseData);
    assert.equal(responseData.success, true);
    
    const aggregates = responseData.aggregates;
    assert.equal(aggregates.totalStudents, 3);
    assert.equal(aggregates.duplicateCount, 2); // Student A and B share ROLL-A-111

    // Find Student A in response
    const clientA = responseData.students.find(s => s.id === 9901);
    assert.ok(clientA);
    // Student A has 3 connections that are not synced: codechef, codeforces, hackerrank.
    // Score is average: (100 + 0 + 0 + 0) / 4 = 25.
    assert.equal(clientA.healthScore, 25);
    assert.equal(clientA.healthIndicator, 'Needs Attention');

    // Find Student C in response
    const clientC = responseData.students.find(s => s.id === 9903);
    assert.ok(clientC);
    assert.ok(clientC.missingFields.includes('section')); // Missing section field
    assert.ok(clientC.healthScore < 50); // Score should be lower due to sync errors and missing fields
    assert.equal(clientC.healthIndicator, 'Needs Attention');

  } finally {
    // Restore original query function
    db.query = originalQuery;
  }
});

after(async () => {
  const pool = db.getPool();
  if (pool) await pool.end();
});
