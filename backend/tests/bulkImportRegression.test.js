const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const studentController = require('../controllers/studentController');
const syncQueue = require('../utils/syncQueue');

// Helper to construct mock response object
function mockResponse() {
  return {
    statusCode: 200,
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.data = data; return this; }
  };
}

const { setAdapter, resetAdapters } = require('../services/adapters/AdapterFactory');

let originalEnqueue;

before(async () => {
  await db.initializeDatabase();
  // Mock syncQueue.enqueue globally to avoid database access after pool ends
  originalEnqueue = syncQueue.enqueue;
  syncQueue.enqueue = () => {};

  setAdapter('leetcode', {
    getProfile: async (username) => ({ verified: true, username: username || 'test_lc', rating: 1500 })
  });

  // Clear any existing test data to ensure clean environment
  await db.query("DELETE FROM Users WHERE roll_no LIKE 'IMPORT-TEST-%'");
  await db.query("DELETE FROM ImportSessionBatches WHERE session_id LIKE 'session-test-%'");
});

test('Bulk Import - Dry Run does not write to DB', async () => {
  const req = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'IMPORT-TEST-001',
          name: 'Dry Run Student',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'dryrun_lc',
          email: 'dryrun@example.com',
          collegeCode: 'DEC'
        }
      ],
      duplicateStrategy: 'skip',
      dryRun: true,
      importSessionId: 'session-test-dryrun',
      batchIndex: 0
    }
  };

  const res = mockResponse();
  await studentController.bulkImportStudents(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  assert.match(res.data.message, /Dry run completed/);

  // Verify no DB insertion occurred
  const checkDb = await db.query("SELECT id FROM Users WHERE roll_no = 'IMPORT-TEST-001'");
  assert.equal(checkDb.length, 0);
});

test('Bulk Import - Successful Commit & Sync Queue triggering', async () => {
  // Clear sync queue state
  const enqueuedJobs = [];
  const originalEnqueue = syncQueue.enqueue;
  syncQueue.enqueue = (userId, platform, username) => {
    enqueuedJobs.push({ userId, platform, username });
  };

  try {
    const req = {
      body: {
        students: [
          {
            rowNumber: 2,
            rollNo: 'IMPORT-TEST-002',
            name: 'Commit Student',
            department: 'CSE',
            section: 'A',
            academicBatch: '2024-2028',
            leetcodeUsername: 'commit_lc',
            codeforcesUsername: 'commit_cf',
            email: 'commit@example.com',
            phoneNumber: '1234567890',
            remarks: 'Special admission',
            collegeCode: 'DEC'
          }
        ],
        duplicateStrategy: 'skip',
        dryRun: false,
        importSessionId: 'session-test-commit',
        batchIndex: 0
      }
    };

    const res = mockResponse();
    await studentController.bulkImportStudents(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.success, true);

    // Verify DB insertion
    const [userRow] = await db.query(
      "SELECT name, department, section, email, phone_number, remarks, college_code FROM Users WHERE roll_no = 'IMPORT-TEST-002'"
    );
    assert.ok(userRow);
    assert.equal(userRow.name, 'Commit Student');
    assert.equal(userRow.email, 'commit@example.com');
    assert.equal(userRow.phone_number, '1234567890');
    assert.equal(userRow.remarks, 'Special admission');
    assert.equal(userRow.college_code, 'DEC');

    // Verify enqueued sync jobs
    assert.ok(enqueuedJobs.length >= 2); // LeetCode and Codeforces enqueued
    const lcJob = enqueuedJobs.find(j => j.platform === 'leetcode');
    const cfJob = enqueuedJobs.find(j => j.platform === 'codeforces');
    assert.ok(lcJob);
    assert.equal(lcJob.username, 'commit_lc');
    assert.ok(cfJob);
    assert.equal(cfJob.username, 'commit_cf');

  } finally {
    syncQueue.enqueue = originalEnqueue;
  }
});

test('Bulk Import - Duplicate Strategy (Skip, Update, Abort)', async () => {
  // Insert initial record to collide with
  await db.query(
    `INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status, email)
     VALUES ('Initial Student', 'IMPORT-TEST-003', 'CSE', 'A', 'initial_lc', '2024-2028', '2024-07-01', '2028-06-30', 'active', 'initial@example.com')`
  );

  // 1. Strategy = 'skip'
  const skipReq = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'IMPORT-TEST-003',
          name: 'Skip Student Change',
          department: 'CSE',
          section: 'B',
          academicBatch: '2024-2028',
          leetcodeUsername: 'initial_lc',
          email: 'initial@example.com'
        }
      ],
      duplicateStrategy: 'skip',
      dryRun: false,
      importSessionId: 'session-test-skip',
      batchIndex: 0
    }
  };
  const skipRes = mockResponse();
  await studentController.bulkImportStudents(skipReq, skipRes);
  assert.equal(skipRes.statusCode, 200);
  assert.equal(skipRes.data.details.skippedCount, 1);

  // Verify record remains unchanged
  const [skipCheck] = await db.query("SELECT name, section FROM Users WHERE roll_no = 'IMPORT-TEST-003'");
  assert.equal(skipCheck.name, 'Initial Student');
  assert.equal(skipCheck.section, 'A');

  // 2. Strategy = 'update'
  const updateReq = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'IMPORT-TEST-003',
          name: 'Updated Student Name',
          department: 'CSE',
          section: 'B',
          academicBatch: '2024-2028',
          leetcodeUsername: 'initial_lc',
          email: 'initial@example.com'
        }
      ],
      duplicateStrategy: 'update',
      dryRun: false,
      importSessionId: 'session-test-update',
      batchIndex: 0
    }
  };
  const updateRes = mockResponse();
  await studentController.bulkImportStudents(updateReq, updateRes);
  assert.equal(updateRes.statusCode, 200);

  // Verify record is updated
  const [updateCheck] = await db.query("SELECT name, section FROM Users WHERE roll_no = 'IMPORT-TEST-003'");
  assert.equal(updateCheck.name, 'Updated Student Name');
  assert.equal(updateCheck.section, 'B');

  // 3. Strategy = 'abort'
  const abortReq = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'IMPORT-TEST-004',
          name: 'Successful Row',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'success_lc',
          email: 'success@example.com'
        },
        {
          rowNumber: 3,
          rollNo: 'IMPORT-TEST-003', // collides with existing
          name: 'Colliding Row',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'initial_lc',
          email: 'initial@example.com'
        }
      ],
      duplicateStrategy: 'abort',
      dryRun: false,
      importSessionId: 'session-test-abort',
      batchIndex: 0
    }
  };
  const abortRes = mockResponse();
  await studentController.bulkImportStudents(abortReq, abortRes);
  assert.equal(abortRes.statusCode, 400);

  // Verify that the whole batch rolled back (IMPORT-TEST-004 was NOT inserted)
  const checkAbortInsert = await db.query("SELECT id FROM Users WHERE roll_no = 'IMPORT-TEST-004'");
  assert.equal(checkAbortInsert.length, 0);
});

test('Bulk Import - Backward Compatibility (compute dates and default status)', async () => {
  const req = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'IMPORT-TEST-005',
          name: 'Old Format Student',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'oldformat_lc'
          // no start/end dates, no email, phone, remarks
        }
      ],
      duplicateStrategy: 'skip',
      dryRun: false,
      importSessionId: 'session-test-backward',
      batchIndex: 0
    }
  };

  const res = mockResponse();
  await studentController.bulkImportStudents(req, res);

  assert.equal(res.statusCode, 200);

  // Verify that dates were calculated and status defaulted to active
  const [userRow] = await db.query(
    "SELECT academic_start_date, academic_end_date, status, email, phone_number, remarks FROM Users WHERE roll_no = 'IMPORT-TEST-005'"
  );
  assert.ok(userRow);
  assert.equal(userRow.status, 'active');
  assert.equal(userRow.email, null);
  assert.equal(userRow.phone_number, null);
  assert.equal(userRow.remarks, null);

  // Start/End Dates computed from batch: 2024-07-01 and 2028-06-30
  const formatDate = (d) => {
    if (!(d instanceof Date)) return String(d);
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${dy}`;
  };
  const startStr = formatDate(userRow.academic_start_date);
  const endStr = formatDate(userRow.academic_end_date);
  assert.equal(startStr, '2024-07-01');
  assert.equal(endStr, '2028-06-30');
});

test('Bulk Import - Empty rows are skipped', async () => {
  const req = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: '',
          name: '',
          department: '',
          section: '',
          academicBatch: '',
          leetcodeUsername: ''
        },
        {
          rowNumber: 3,
          rollNo: 'IMPORT-TEST-006',
          name: 'Valid Student',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'valid_lc'
        }
      ],
      duplicateStrategy: 'skip',
      dryRun: false,
      importSessionId: 'session-test-empty',
      batchIndex: 0
    }
  };

  const res = mockResponse();
  await studentController.bulkImportStudents(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.details.skippedCount, 1);
  assert.equal(res.data.details.importedCount, 1);

  const checkDb = await db.query("SELECT id FROM Users WHERE roll_no = 'IMPORT-TEST-006'");
  assert.equal(checkDb.length, 1);
});

test('Bulk Import - HackerRank username import and profile seeding', async () => {
  const req = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'IMPORT-TEST-007',
          name: 'HackerRank Student',
          department: 'CSE',
          section: 'B',
          academicBatch: '2024-2028',
          leetcodeUsername: 'hr_test_lc',
          hackerrank_username: 'hr_test_handle'
        }
      ],
      duplicateStrategy: 'skip',
      dryRun: false,
      importSessionId: 'session-test-hr',
      batchIndex: 0
    }
  };

  const res = mockResponse();
  await studentController.bulkImportStudents(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.details.importedCount, 1);

  const [userRow] = await db.query("SELECT id, hackerrank_username FROM Users WHERE roll_no = 'IMPORT-TEST-007'");
  assert.ok(userRow);
  assert.equal(userRow.hackerrank_username, 'hr_test_handle');

  const hrProfile = await db.query("SELECT * FROM HackerRankProfiles WHERE user_id = ?", [userRow.id]);
  assert.equal(hrProfile.length, 1);
});

test('Bulk Import - HackerRank username empty/optional column handled seamlessly', async () => {
  const req = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'IMPORT-TEST-008',
          name: 'No HR Student',
          department: 'CSE',
          section: 'B',
          academicBatch: '2024-2028',
          leetcodeUsername: 'nohr_test_lc',
          hackerrank_username: ''
        }
      ],
      duplicateStrategy: 'skip',
      dryRun: false,
      importSessionId: 'session-test-nohr',
      batchIndex: 0
    }
  };

  const res = mockResponse();
  await studentController.bulkImportStudents(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.details.importedCount, 1);

  const [userRow] = await db.query("SELECT id, hackerrank_username FROM Users WHERE roll_no = 'IMPORT-TEST-008'");
  assert.ok(userRow);
  assert.equal(userRow.hackerrank_username, null);
});

after(async () => {
  resetAdapters();
  // Restore original enqueue
  if (originalEnqueue) {
    syncQueue.enqueue = originalEnqueue;
  }
  // Clean up database test entries
  await db.query("DELETE FROM Users WHERE roll_no LIKE 'IMPORT-TEST-%'");
  await db.query("DELETE FROM ImportSessionBatches WHERE session_id LIKE 'session-test-%'");
  await db.closePool();
});
