const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const studentController = require('../controllers/studentController');
const syncQueue = require('../utils/syncQueue');
const { setAdapter, resetAdapters } = require('../services/adapters/AdapterFactory');
const {
  generateImportReportExcel,
  generateInvalidIDsExcel,
  parseExcelBuffer,
  formatReportFilename
} = require('../utils/importReportGenerator');

// Helper to construct mock response object
function mockResponse() {
  return {
    statusCode: 200,
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.data = data; return this; }
  };
}

// Mock LeetCode Adapter for testing validation pathways
class MockLeetCodeAdapter {
  constructor() {
    this.validUsers = new Set(['user_valid_1', 'user_valid_2', 'user_valid_3', 'existing_db_user']);
    this.failMap = new Map(); // username -> error object or reason
    this.callCounts = new Map();
  }

  async getProfile(username) {
    const norm = (username || '').toLowerCase().trim();
    this.callCounts.set(norm, (this.callCounts.get(norm) || 0) + 1);

    if (this.failMap.has(norm)) {
      const errConfig = this.failMap.get(norm);
      if (errConfig.type === 'CLOUDFLARE') {
        const err = new Error('Cloudflare access denied');
        err.isCloudflare = true;
        throw err;
      }
      if (errConfig.type === 'RATE_LIMIT') {
        const err = new Error('429 Rate limit exceeded');
        err.status = 429;
        throw err;
      }
      if (errConfig.type === 'TIMEOUT') {
        const err = new Error('Request timed out');
        err.code = 'ETIMEDOUT';
        throw err;
      }
      if (errConfig.type === 'NETWORK_ERROR') {
        throw new Error('Connection reset by peer');
      }
      if (errConfig.type === 'NOT_FOUND') {
        return { verified: false, message: 'User not found', username };
      }
    }

    if (this.validUsers.has(norm)) {
      return { verified: true, username: norm, rating: 1600 };
    }

    return { verified: false, message: 'Account does not exist', username };
  }
}

let mockAdapter;
let originalEnqueue;

before(async () => {
  await db.initializeDatabase();
  originalEnqueue = syncQueue.enqueue;
  syncQueue.enqueue = () => {};

  await db.query("DELETE FROM Users WHERE roll_no LIKE 'VALID-TEST-%'");
  await db.query("DELETE FROM ImportSessionBatches WHERE session_id LIKE 'val-test-%'");
  await db.query("DELETE FROM BulkImportAuditLogs WHERE session_id LIKE 'val-test-%'");
});

beforeEach(() => {
  mockAdapter = new MockLeetCodeAdapter();
  setAdapter('leetcode', mockAdapter);
});

after(async () => {
  resetAdapters();
  if (originalEnqueue) {
    syncQueue.enqueue = originalEnqueue;
  }
  await db.query("DELETE FROM Users WHERE roll_no LIKE 'VALID-TEST-%'");
  await db.query("DELETE FROM ImportSessionBatches WHERE session_id LIKE 'val-test-%'");
  await db.query("DELETE FROM BulkImportAuditLogs WHERE session_id LIKE 'val-test-%'");
  await db.closePool();
});

test('LeetCode Validation - 1. All valid usernames are imported normally', async () => {
  const req = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'VALID-TEST-001',
          name: 'Student One',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'user_valid_1'
        },
        {
          rowNumber: 3,
          rollNo: 'VALID-TEST-002',
          name: 'Student Two',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'user_valid_2'
        }
      ],
      duplicateStrategy: 'skip',
      dryRun: false,
      importSessionId: 'val-test-allvalid',
      batchIndex: 0
    }
  };

  const res = mockResponse();
  await studentController.bulkImportStudents(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.details.importedCount, 2);
  assert.equal(res.data.details.invalidLeetCodeCount, 0);

  // Check DB records
  const dbUsers = await db.query("SELECT roll_no, leetcode_username FROM Users WHERE roll_no LIKE 'VALID-TEST-00%'");
  assert.equal(dbUsers.length, 2);
});

test('LeetCode Validation - 2. Mixed valid and invalid usernames', async () => {
  const req = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'VALID-TEST-003',
          name: 'Valid Student',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'user_valid_3'
        },
        {
          rowNumber: 3,
          rollNo: 'VALID-TEST-004',
          name: 'Nonexistent Student',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'nonexistent_user_999'
        }
      ],
      duplicateStrategy: 'skip',
      dryRun: false,
      importSessionId: 'val-test-mixed',
      batchIndex: 0
    }
  };

  const res = mockResponse();
  await studentController.bulkImportStudents(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.details.importedCount, 1);
  assert.equal(res.data.details.invalidLeetCodeCount, 1);

  // Verify non-existent student was NOT inserted into DB
  const nonexistentDb = await db.query("SELECT id FROM Users WHERE roll_no = 'VALID-TEST-004'");
  assert.equal(nonexistentDb.length, 0);

  // Verify rejection reason
  const invalidRow = res.data.details.invalidLeetCode.find(r => r.rollNo === 'VALID-TEST-004');
  assert.ok(invalidRow);
  assert.equal(invalidRow.reason, 'Account does not exist');
});

test('LeetCode Validation - 3. Duplicate usernames (in-file and in-DB collisions)', async () => {
  // Insert initial user into DB to collide with
  await db.query(
    `INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status)
     VALUES ('Existing User', 'VALID-TEST-000', 'CSE', 'A', 'existing_db_user', '2024-2028', '2024-07-01', '2028-06-30', 'active')`
  );

  const req = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'VALID-TEST-005',
          name: 'File Dup 1',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'user_valid_1'
        },
        {
          rowNumber: 3,
          rollNo: 'VALID-TEST-006',
          name: 'File Dup 2',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'user_valid_1' // In-file duplicate of row 2
        },
        {
          rowNumber: 4,
          rollNo: 'VALID-TEST-007',
          name: 'Claim DB User',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'existing_db_user' // Belongs to VALID-TEST-000 in DB
        }
      ],
      duplicateStrategy: 'skip',
      dryRun: false,
      importSessionId: 'val-test-duplicates',
      batchIndex: 0
    }
  };

  const res = mockResponse();
  await studentController.bulkImportStudents(req, res);

  assert.equal(res.statusCode, 200);

  const invalidList = res.data.details.invalidLeetCode;
  const fileDup = invalidList.find(r => r.rollNo === 'VALID-TEST-006');
  const dbDup = invalidList.find(r => r.rollNo === 'VALID-TEST-007');

  assert.ok(fileDup);
  assert.equal(fileDup.reason, 'Duplicate in uploaded file');

  assert.ok(dbDup);
  assert.equal(dbDup.reason, 'Username already assigned to another student');
});

test('LeetCode Validation - 4. Empty and bad format usernames', async () => {
  const req = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'VALID-TEST-008',
          name: 'Empty Handle Student',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: ''
        },
        {
          rowNumber: 3,
          rollNo: 'VALID-TEST-009',
          name: 'Bad Format Student',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'ab' // < 3 chars format error
        }
      ],
      duplicateStrategy: 'skip',
      dryRun: false,
      importSessionId: 'val-test-emptyformat',
      batchIndex: 0
    }
  };

  const res = mockResponse();
  await studentController.bulkImportStudents(req, res);

  assert.equal(res.statusCode, 200);

  const invalidList = res.data.details.invalidLeetCode;
  const emptyRow = invalidList.find(r => r.rollNo === 'VALID-TEST-008');
  const badFormatRow = invalidList.find(r => r.rollNo === 'VALID-TEST-009');

  assert.ok(emptyRow);
  assert.equal(emptyRow.reason, 'Username missing');

  assert.ok(badFormatRow);
  assert.equal(badFormatRow.reason, 'Invalid username format');
});

test('LeetCode Validation - 5. Outage resilience and retry error mapping', async () => {
  mockAdapter.failMap.set('user_cf', { type: 'CLOUDFLARE' });
  mockAdapter.failMap.set('user_429', { type: 'RATE_LIMIT' });
  mockAdapter.failMap.set('user_timeout', { type: 'TIMEOUT' });
  mockAdapter.failMap.set('user_retryfail', { type: 'NETWORK_ERROR' });

  const req = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'VALID-TEST-010',
          name: 'Cloudflare Student',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'user_cf'
        },
        {
          rowNumber: 3,
          rollNo: 'VALID-TEST-011',
          name: 'Rate Limited Student',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'user_429'
        },
        {
          rowNumber: 4,
          rollNo: 'VALID-TEST-012',
          name: 'Timeout Student',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'user_timeout'
        },
        {
          rowNumber: 5,
          rollNo: 'VALID-TEST-013',
          name: 'Retry Fail Student',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'user_retryfail'
        }
      ],
      duplicateStrategy: 'skip',
      dryRun: false,
      importSessionId: 'val-test-outage',
      batchIndex: 0
    }
  };

  const res = mockResponse();
  await studentController.bulkImportStudents(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.details.importedCount, 0);

  const invalidList = res.data.details.invalidLeetCode;

  const cfRow = invalidList.find(r => r.rollNo === 'VALID-TEST-010');
  const rlRow = invalidList.find(r => r.rollNo === 'VALID-TEST-011');
  const toRow = invalidList.find(r => r.rollNo === 'VALID-TEST-012');
  const rfRow = invalidList.find(r => r.rollNo === 'VALID-TEST-013');

  assert.ok(cfRow);
  assert.equal(cfRow.reason, 'Cloudflare blocked');

  assert.ok(rlRow);
  assert.equal(rlRow.reason, 'Rate limited');

  assert.ok(toRow);
  assert.equal(toRow.reason, 'Verification timeout');

  assert.ok(rfRow);
  assert.equal(rfRow.reason, 'Unable to verify after retries');

  // Verify pendingCount metric
  assert.equal(res.data.details.pendingCount, 4);
});

test('LeetCode Validation - 6. Excel report generation and timestamped filenames', () => {
  const importedStudents = [
    {
      rollNo: '22CS101',
      name: 'John Doe',
      department: 'CSE',
      section: 'A',
      leetcodeUsername: 'john_lc',
      codechefUsername: 'john_cc',
      codeforcesUsername: 'john_cf',
      hackerrankUsername: 'john_hr',
      status: 'Imported'
    }
  ];

  const invalidRows = [
    {
      rollNo: '22CS102',
      name: 'Jane Smith',
      department: 'CSE',
      section: 'A',
      leetcodeUsername: 'bad_user',
      reason: 'Account does not exist'
    }
  ];

  // Test full 2-sheet report Buffer
  const fullBuffer = generateImportReportExcel(importedStudents, invalidRows);
  assert.ok(Buffer.isBuffer(fullBuffer));

  const parsedFull = parseExcelBuffer(fullBuffer);
  assert.ok(parsedFull['Imported Students']);
  assert.ok(parsedFull['Invalid LeetCode IDs']);
  assert.equal(parsedFull['Imported Students'].length, 1);
  assert.equal(parsedFull['Invalid LeetCode IDs'].length, 1);
  assert.equal(parsedFull['Invalid LeetCode IDs'][0]['Reason'], 'Account does not exist');

  // Test single-sheet Invalid IDs report Buffer
  const invalidBuffer = generateInvalidIDsExcel(invalidRows);
  assert.ok(Buffer.isBuffer(invalidBuffer));

  const parsedInvalid = parseExcelBuffer(invalidBuffer);
  assert.ok(parsedInvalid['Invalid LeetCode IDs']);
  assert.equal(parsedInvalid['Invalid LeetCode IDs'].length, 1);

  // Test filename formatting
  const testDate = new Date('2026-07-24T10:35:00');
  const reportName = formatReportFilename('BulkImportReport', testDate);
  const invalidName = formatReportFilename('InvalidLeetCodeIDs', testDate);

  assert.equal(reportName, 'BulkImportReport_2026-07-24_10-35.xlsx');
  assert.equal(invalidName, 'InvalidLeetCodeIDs_2026-07-24_10-35.xlsx');
});

test('LeetCode Validation - 7. Import summary metrics & audit log persistence', async () => {
  mockAdapter.validUsers.add('user_valid_fresh_7');

  const req = {
    body: {
      students: [
        {
          rowNumber: 2,
          rollNo: 'VALID-TEST-014',
          name: 'Summary Student 1',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'user_valid_fresh_7'
        },
        {
          rowNumber: 3,
          rollNo: 'VALID-TEST-015',
          name: 'Summary Student 2',
          department: 'CSE',
          section: 'A',
          academicBatch: '2024-2028',
          leetcodeUsername: 'summary_invalid_lc_test_999'
        }
      ],
      duplicateStrategy: 'skip',
      dryRun: false,
      importSessionId: 'val-test-summary-audit',
      batchIndex: 0
    }
  };

  const res = mockResponse();
  await studentController.bulkImportStudents(req, res);

  assert.equal(res.statusCode, 200);
  const details = res.data.details;

  assert.equal(details.totalRows, 2);
  assert.equal(details.importedCount, 1);
  assert.equal(details.invalidLeetCodeCount, 1);
  assert.ok(typeof details.processingTime === 'string');
  assert.ok(details.processingTimeMs >= 0);

  // Verify Audit Log DB persistence
  const logs = await db.query(
    "SELECT session_id, total_rows, imported_count, invalid_count FROM BulkImportAuditLogs WHERE session_id = 'val-test-summary-audit'"
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0].total_rows, 2);
  assert.equal(logs[0].imported_count, 1);
  assert.equal(logs[0].invalid_count, 1);
});
