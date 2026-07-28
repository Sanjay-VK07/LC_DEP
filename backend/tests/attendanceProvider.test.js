const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const AttendanceProviderFactory = require('../services/providers/AttendanceProviderFactory');
const GraphQLAttendanceProvider = require('../services/providers/GraphQLAttendanceProvider');
const CsvAttendanceProvider = require('../services/providers/CsvAttendanceProvider');
const LegacyAttendanceProvider = require('../services/providers/LegacyAttendanceProvider');
const StudentContestSyncService = require('../services/StudentContestSyncService');
const db = require('../config/db');

describe('AttendanceProvider Abstraction & StudentContestSyncService Test Suite', () => {
  before(async () => {
    await db.initializeDatabase();
  });

  after(async () => {
    try {
      const pool = db.getPool();
      await pool.end();
    } catch (e) {}
  });

  describe('Phase 1: Provider Factory Unit Tests', () => {
    it('should instantiate GraphQLAttendanceProvider for "GRAPHQL"', () => {
      const provider = AttendanceProviderFactory.getProvider('GRAPHQL');
      assert.equal(provider instanceof GraphQLAttendanceProvider, true);
      assert.equal(provider.providerName, 'GRAPHQL');
    });

    it('should instantiate CsvAttendanceProvider for "CSV"', () => {
      const provider = AttendanceProviderFactory.getProvider('CSV', { csvRecords: [{ username: 'user1' }] });
      assert.equal(provider instanceof CsvAttendanceProvider, true);
      assert.equal(provider.providerName, 'CSV');
    });

    it('should instantiate LegacyAttendanceProvider for "LEGACY"', () => {
      const provider = AttendanceProviderFactory.getProvider('LEGACY');
      assert.equal(provider instanceof LegacyAttendanceProvider, true);
      assert.equal(provider.providerName, 'LEGACY');
    });

    it('should default to GraphQL for "HYBRID" or unhandled types', () => {
      const provider = AttendanceProviderFactory.getProvider('HYBRID');
      assert.equal(provider instanceof GraphQLAttendanceProvider, true);
    });
  });

  describe('Phase 2: CsvAttendanceProvider Matching Tests', () => {
    it('should match student usernames and roll numbers correctly', async () => {
      const csvData = [
        { username: 'leetcode_user_1', rank: 150, score: 20, attendance_status: 'PRESENT' },
        { roll_no: '21CS002', rank: 500, score: 10, attendance_status: 'PRESENT' }
      ];

      const provider = new CsvAttendanceProvider(csvData);
      const students = [
        { id: 101, leetcode_username: 'leetcode_user_1', roll_no: '21CS001' },
        { id: 102, leetcode_username: 'user_two', roll_no: '21CS002' },
        { id: 103, leetcode_username: 'user_three', roll_no: '21CS003' }
      ];

      const results = await provider.resolveAttendance({ contestSlug: 'weekly-contest-400', students });
      assert.equal(results.length, 3);

      const s1 = results.find(r => r.studentId === 101);
      assert.equal(s1.status, 'PRESENT');
      assert.equal(s1.rank, 150);

      const s2 = results.find(r => r.studentId === 102);
      assert.equal(s2.status, 'PRESENT');
      assert.equal(s2.rank, 500);

      const s3 = results.find(r => r.studentId === 103);
      assert.equal(s3.status, 'ABSENT');
    });
  });

  describe('Phase 3: State Machine & Downgrade Protection Integration Test', () => {
    it('should preserve PRESENT status when upstream returns UNKNOWN or ABSENT', async () => {
      const activeStudents = await db.query("SELECT id, leetcode_username FROM Users WHERE status = 'active' AND leetcode_username IS NOT NULL LIMIT 1");
      if (activeStudents.length === 0) return;

      const targetStudent = activeStudents[0];
      const targetHandle = targetStudent.leetcode_username;
      const contestSlug = 'test-downgrade-protection-contest';

      const mockCsvRecords = [
        { username: targetHandle, rank: 10, score: 20, attendance_status: 'PRESENT' }
      ];

      // 1. Initial sync marking student PRESENT
      const firstSync = await StudentContestSyncService.syncContestAttendance({
        contestSlug,
        providerType: 'CSV',
        csvRecords: mockCsvRecords,
        actor: 'TEST_SUITE'
      });

      assert.equal(firstSync.success, true);
      assert.equal(firstSync.presentCount >= 1, true);

      // 2. Second sync with empty CSV (student missing from upstream)
      const secondSync = await StudentContestSyncService.syncContestAttendance({
        contestSlug,
        providerType: 'CSV',
        csvRecords: [],
        actor: 'TEST_SUITE'
      });

      assert.equal(secondSync.success, true);

      // Verify PRESENT status was preserved in database
      const rows = await db.query(
        "SELECT ca.attendanceStatus FROM ContestAttendance ca JOIN LiveContests lc ON ca.contestId = lc.id WHERE lc.contestSlug = ? AND ca.studentId = ?",
        [contestSlug, targetStudent.id]
      );

      if (rows.length > 0) {
        assert.equal(rows[0].attendanceStatus, 'Present');
      }
    });
  });
});
