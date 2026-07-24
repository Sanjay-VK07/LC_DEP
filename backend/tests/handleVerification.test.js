const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const platformRegistry = require('../services/PlatformRegistry');
const VerificationRepository = require('../repositories/VerificationRepository');
const PlatformValidator = require('../services/PlatformValidator');
const { setAdapter, resetAdapters } = require('../services/adapters/AdapterFactory');
const {
  generateImportReportExcel,
  parseExcelBuffer,
  formatReportFilename
} = require('../utils/importReportGenerator');

// Mock adapter for multi-platform test suite
class MockGenericAdapter {
  constructor(platform) {
    this.platform = platform;
    this.validUsers = new Set([`${platform}_valid_1`, `${platform}_valid_2`, 'test_user_123']);
  }

  async getProfile(username) {
    const norm = (username || '').toLowerCase().trim();
    if (this.validUsers.has(norm)) {
      return { verified: true, username: norm, rating: 1500 };
    }
    if (norm.includes('error')) {
      throw new Error('API connection reset');
    }
    return { verified: false, message: 'User not found', username: norm };
  }
}

before(async () => {
  await db.initializeDatabase();
  await db.query("DELETE FROM HandleVerifications WHERE username_normalized LIKE 'test_%' OR username_normalized LIKE '%_valid_%'");
  await db.query("DELETE FROM Users WHERE roll_no LIKE 'VERIF-TEST-%'");
});

beforeEach(() => {
  ['leetcode', 'codechef', 'codeforces', 'hackerrank'].forEach(p => {
    setAdapter(p, new MockGenericAdapter(p));
  });
});

after(async () => {
  resetAdapters();
  await db.query("DELETE FROM HandleVerifications WHERE username_normalized LIKE 'test_%' OR username_normalized LIKE '%_valid_%'");
  await db.query("DELETE FROM Users WHERE roll_no LIKE 'VERIF-TEST-%'");
  await db.closePool();
});

test('PlatformRegistry - Pre-registers default platforms and supports custom plugin registration', () => {
  assert.equal(platformRegistry.has('leetcode'), true);
  assert.equal(platformRegistry.has('codechef'), true);
  assert.equal(platformRegistry.has('codeforces'), true);
  assert.equal(platformRegistry.has('hackerrank'), true);

  // Plugin registration test
  platformRegistry.register({
    name: 'atcoder',
    adapterName: 'atcoder',
    regex: /^[a-zA-Z0-9_]{3,20}$/,
    enabled: true
  });
  assert.equal(platformRegistry.has('atcoder'), true);
  assert.equal(platformRegistry.get('atcoder').adapterName, 'atcoder');
});

test('Username Normalization - Lowercases case-insensitive platforms and preserves original string', () => {
  const normLC = PlatformValidator.normalizeUsername('leetcode', '  User_Test  ');
  assert.equal(normLC.original, 'User_Test');
  assert.equal(normLC.normalized, 'user_test');

  const normCF = PlatformValidator.normalizeUsername('codeforces', '  Tourist_CF  ');
  assert.equal(normCF.original, 'Tourist_CF');
  assert.equal(normCF.normalized, 'Tourist_CF'); // Codeforces is case-sensitive
});

test('VerificationRepository - CRUD operations on HandleVerifications table', async () => {
  const record = {
    userId: null,
    platform: 'leetcode',
    usernameOriginal: 'Test_User_123',
    usernameNormalized: 'test_user_123',
    verificationStatus: 'VERIFIED',
    verificationSource: 'API',
    verifiedAt: new Date(),
    verificationExpiry: new Date(Date.now() + 30 * 84600 * 1000),
    lastError: null
  };

  const success = await VerificationRepository.upsertVerification(record);
  assert.equal(success, true);

  const found = await VerificationRepository.findByPlatformAndUsername('leetcode', 'test_user_123');
  assert.notEqual(found, null);
  assert.equal(found.verification_status, 'VERIFIED');
  assert.equal(found.username_original, 'Test_User_123');
});

test('PlatformValidator - Orchestrates verification, cache check, and metrics collection', async () => {
  const validator = new PlatformValidator();
  
  // First verification (Cache miss -> API)
  const res1 = await validator.verify('leetcode', 'leetcode_valid_1');
  assert.equal(res1.verified, true);
  assert.equal(res1.status, 'VERIFIED');
  assert.equal(res1.source, 'API');

  // Second verification (Cache hit)
  const res2 = await validator.verify('leetcode', 'leetcode_valid_1');
  assert.equal(res2.verified, true);
  assert.equal(res2.source, 'CACHE');

  const metrics = validator.getMetrics();
  assert.equal(metrics.cacheHits, 1);
  assert.equal(metrics.cacheMisses, 1);
  assert.equal(metrics.cacheHitRate, 50.0);
});

test('PlatformValidator - Cache Expiry triggers fresh re-verification', async () => {
  // Insert an expired record into HandleVerifications
  await VerificationRepository.upsertVerification({
    platform: 'codechef',
    usernameOriginal: 'codechef_valid_1',
    usernameNormalized: 'codechef_valid_1',
    verificationStatus: 'VERIFIED',
    verificationSource: 'API',
    verifiedAt: new Date(Date.now() - 40 * 84600 * 1000),
    verificationExpiry: new Date(Date.now() - 10 * 84600 * 1000) // expired
  });

  const validator = new PlatformValidator();
  const res = await validator.verify('codechef', 'codechef_valid_1');
  assert.equal(res.verified, true);
  assert.equal(res.source, 'API'); // Re-verified via API because cache was expired
});

test('Import Report Generator - 3-Sheet Excel report with Import Summary and Excel Row columns', () => {
  const imported = [
    { rollNo: '22CS101', name: 'Student 1', department: 'CSE', section: 'A', leetcodeUsername: 'leetcode_valid_1' }
  ];
  const invalid = [
    { excelRow: 57, platform: 'LeetCode', rollNo: '22CS102', name: 'Student 2', department: 'CSE', section: 'A', leetcodeUsername: 'invalid_user', reason: 'Account does not exist' }
  ];

  const summaryMeta = {
    importJobId: 'job-test-12345',
    date: '2026-07-24 12:00',
    importedBy: 'Admin',
    totalRows: 2,
    importedCount: 1,
    invalidCount: 1,
    cacheHits: 5,
    cacheMisses: 2,
    apiRequests: 2,
    apiFailures: 1,
    processingTimeMs: 120,
    validationPolicy: 'STRICT'
  };

  const buffer = generateImportReportExcel(imported, invalid, summaryMeta);
  assert.ok(buffer.length > 0);

  const sheets = parseExcelBuffer(buffer);
  const invalidSheetName = Object.keys(sheets).find(k => k.includes('Invalid')) || 'Invalid LeetCode IDs';
  assert.ok(sheets['Import Summary']);
  assert.ok(sheets['Imported Students']);
  assert.ok(sheets[invalidSheetName]);

  // Check Sheet 1: Import Summary metadata
  const summarySheet = sheets['Import Summary'];
  const jobIdRow = summarySheet.find(r => r.Property === 'Import Job ID');
  assert.equal(jobIdRow.Value, 'job-test-12345');

  // Check Sheet 3: Invalid IDs columns
  const invalidSheet = sheets[invalidSheetName];
  assert.equal(invalidSheet[0]['Excel Row'], 57);
  assert.equal(invalidSheet[0]['Platform'], 'LeetCode');
  assert.equal(invalidSheet[0]['Reason'], 'Account does not exist');
});
