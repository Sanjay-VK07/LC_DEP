const db = require('../config/db');
const StudentContestSyncService = require('./StudentContestSyncService');
const { normalizeUsername } = require('../utils/usernameNormalizer');

class ContestImportService {
  /**
   * Import contest attendance from parsed CSV / Excel spreadsheet rows.
   * @param {object} options
   * @param {string} options.contestSlug - Target contest slug
   * @param {Array<object>} options.rows - Parsed row objects from file
   * @param {string} options.filename - Original uploaded file name
   * @param {string} options.uploadedBy - Username of administrator uploading file
   * @returns {Promise<object>} - Import execution summary report
   */
  static async importContestAttendance({ contestSlug, rows = [], filename = 'upload.csv', uploadedBy = 'ADMIN' }) {
    const startTime = Date.now();
    console.log(`[ContestImportService] Processing CSV import for contest "${contestSlug}" (${rows.length} rows) from file "${filename}"...`);

    if (!rows || rows.length === 0) {
      throw new Error('Import file is empty or contains no valid rows.');
    }

    // 1. Fetch active students to validate rows
    const activeStudents = await db.query("SELECT id, roll_no, leetcode_username FROM Users WHERE status = 'active'");
    const handleSet = new Set(activeStudents.map(s => normalizeUsername(s.leetcode_username)).filter(Boolean));
    const rollSet = new Set(activeStudents.map(s => String(s.roll_no).trim().toLowerCase()).filter(Boolean));

    let processedRows = 0;
    let rejectedRows = 0;
    const validRecords = [];

    for (const r of rows) {
      const handle = normalizeUsername(r.username || r.leetcode_username || r.handle);
      const rollNo = String(r.roll_no || r.rollNo || '').trim().toLowerCase();

      const isValid = (handle && handleSet.has(handle)) || (rollNo && rollSet.has(rollNo));

      if (isValid) {
        processedRows++;
        validRecords.push(r);
      } else {
        rejectedRows++;
      }
    }

    // 2. Delegate to StudentContestSyncService using CSV provider
    const syncReport = await StudentContestSyncService.syncContestAttendance({
      contestSlug,
      providerType: 'CSV',
      csvRecords: validRecords,
      actor: uploadedBy
    });

    // 3. Record upload history in AuditLog
    await db.query(
      `INSERT INTO AuditLog (action, actor, target_type, target_id, details, severity, result, duration_ms, source_platform)
       VALUES ('CONTEST_CSV_IMPORT', ?, 'CONTEST', ?, ?, 'INFO', 'SUCCESS', ?, 'CSV_IMPORT')`,
      [
        uploadedBy,
        contestSlug,
        JSON.stringify({ filename, totalRows: rows.length, processedRows, rejectedRows, syncReport }),
        Date.now() - startTime
      ]
    );

    return {
      success: true,
      filename,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
      contestSlug,
      totalRows: rows.length,
      processedRows,
      rejectedRows,
      syncReport
    };
  }
}

module.exports = ContestImportService;
//completed