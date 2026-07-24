const xlsx = require('xlsx');
const { ENABLE_IMPORT_REPORTS } = require('../config/verificationConfig');

/**
 * Generate formatted timestamp string for Excel filenames
 */
function formatReportFilename(prefix = 'BulkImportReport', dateInput = new Date(), jobId = null) {
  const d = dateInput instanceof Date && !isNaN(dateInput.getTime()) ? dateInput : new Date();
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  const hr = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');

  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '');
  const jobTag = jobId ? `_${String(jobId).slice(0, 8)}` : '';
  return `${cleanPrefix}${jobTag}_${yr}-${mo}-${dy}_${hr}-${min}.xlsx`;
}

/**
 * Generate 3-sheet Excel report Buffer containing:
 * Sheet 1: Import Summary (Metadata, stats, job ID, metrics, versioning)
 * Sheet 2: Imported Students
 * Sheet 3: Invalid IDs (with Excel Row, Platform, Status, Reason)
 */
function generateImportReportExcel(importedStudents = [], invalidLeetCodeRows = [], summaryMeta = {}) {
  if (!ENABLE_IMPORT_REPORTS) {
    return Buffer.from('');
  }

  const wb = xlsx.utils.book_new();

  // Sheet 1: Import Summary
  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const summaryRows = [
    { Property: 'Import Job ID', Value: summaryMeta.importJobId || summaryMeta.jobId || 'N/A' },
    { Property: 'Date', Value: summaryMeta.date || nowStr },
    { Property: 'Imported By', Value: summaryMeta.importedBy || 'Admin' },
    { Property: 'Total Rows', Value: summaryMeta.totalRows ?? (importedStudents.length + invalidLeetCodeRows.length) },
    { Property: 'Imported', Value: summaryMeta.importedCount ?? importedStudents.length },
    { Property: 'Updated', Value: summaryMeta.updatedCount ?? 0 },
    { Property: 'Invalid', Value: summaryMeta.invalidCount ?? invalidLeetCodeRows.length },
    { Property: 'Pending', Value: summaryMeta.pendingCount ?? 0 },
    { Property: 'Duplicates', Value: summaryMeta.duplicateCount ?? 0 },
    { Property: 'Cache Hits', Value: summaryMeta.cacheHits ?? 0 },
    { Property: 'Cache Misses', Value: summaryMeta.cacheMisses ?? 0 },
    { Property: 'API Requests', Value: summaryMeta.apiRequests ?? 0 },
    { Property: 'API Failures', Value: summaryMeta.apiFailures ?? 0 },
    { Property: 'Processing Time (ms)', Value: summaryMeta.processingTimeMs ?? 0 },
    { Property: 'Validation Policy', Value: summaryMeta.validationPolicy || summaryMeta.validationMode || 'STRICT' },
    // Report Versioning Metadata
    { Property: 'Report Version', Value: '2.0' },
    { Property: 'Schema Version', Value: '1.0' },
    { Property: 'Application Version', Value: '1.0.0' },
    { Property: 'Generated At', Value: nowStr }
  ];

  const wsSummary = xlsx.utils.json_to_sheet(summaryRows);
  xlsx.utils.book_append_sheet(wb, wsSummary, 'Import Summary');

  // Sheet 2: Imported Students
  const sheet2Rows = importedStudents.map(item => ({
    'Roll Number': item.rollNo || item.roll_no || '',
    'Student Name': item.name || '',
    'Department': item.department || '',
    'Section': item.section || '',
    'LeetCode Username': item.leetcodeUsername || item.leetcode_username || '',
    'CodeChef Username': item.codechefUsername || item.codechef_username || '-',
    'Codeforces Username': item.codeforcesUsername || item.codeforces_username || '-',
    'HackerRank Username': item.hackerrankUsername || item.hackerrank_username || '-',
    'Status': item.status || 'Imported'
  }));

  const ws2 = xlsx.utils.json_to_sheet(sheet2Rows.length > 0 ? sheet2Rows : [
    {
      'Roll Number': '',
      'Student Name': '',
      'Department': '',
      'Section': '',
      'LeetCode Username': '',
      'CodeChef Username': '',
      'Codeforces Username': '',
      'HackerRank Username': '',
      'Status': ''
    }
  ]);
  xlsx.utils.book_append_sheet(wb, ws2, 'Imported Students');

  // Sheet 3: Invalid IDs
  const sheet3Rows = invalidLeetCodeRows.map(item => ({
    'Excel Row': item.excelRow || item.rowNumber || item.excel_row || '-',
    'Platform': item.platform || 'LeetCode',
    'Roll Number': item.rollNo || item.roll_no || '',
    'Student Name': item.name || '',
    'Department': item.department || '',
    'Section': item.section || '',
    'Username': item.leetcodeUsername || item.username || item.leetcode_username || '',
    'Status': item.status || 'INVALID',
    'Reason': item.reason || ''
  }));

  const ws3 = xlsx.utils.json_to_sheet(sheet3Rows.length > 0 ? sheet3Rows : [
    {
      'Excel Row': '',
      'Platform': '',
      'Roll Number': '',
      'Student Name': '',
      'Department': '',
      'Section': '',
      'Username': '',
      'Status': '',
      'Reason': ''
    }
  ]);
  const invalidSheetName = summaryMeta.sheet3Name || 'Invalid LeetCode IDs';
  xlsx.utils.book_append_sheet(wb, ws3, invalidSheetName);

  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Generate 1-sheet Excel report Buffer containing ONLY Invalid IDs
 */
function generateInvalidIDsExcel(invalidLeetCodeRows = []) {
  if (!ENABLE_IMPORT_REPORTS) {
    return Buffer.from('');
  }

  const wb = xlsx.utils.book_new();

  const sheetRows = invalidLeetCodeRows.map(item => ({
    'Excel Row': item.excelRow || item.rowNumber || item.excel_row || '-',
    'Platform': item.platform || 'LeetCode',
    'Roll Number': item.rollNo || item.roll_no || '',
    'Student Name': item.name || '',
    'Department': item.department || '',
    'Section': item.section || '',
    'Username': item.leetcodeUsername || item.username || item.leetcode_username || '',
    'Status': item.status || 'INVALID',
    'Reason': item.reason || ''
  }));

  const ws = xlsx.utils.json_to_sheet(sheetRows.length > 0 ? sheetRows : [
    {
      'Excel Row': '',
      'Platform': '',
      'Roll Number': '',
      'Student Name': '',
      'Department': '',
      'Section': '',
      'Username': '',
      'Status': '',
      'Reason': ''
    }
  ]);
  xlsx.utils.book_append_sheet(wb, ws, 'Invalid LeetCode IDs');

  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Helper to parse generated Excel Buffer back into sheet objects (for automated testing)
 */
function parseExcelBuffer(buffer) {
  if (!buffer || buffer.length === 0) return {};
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const result = {};
  workbook.SheetNames.forEach(sheetName => {
    result[sheetName] = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
  });
  return result;
}

module.exports = {
  formatReportFilename,
  generateImportReportExcel,
  generateInvalidIDsExcel,
  parseExcelBuffer
};
