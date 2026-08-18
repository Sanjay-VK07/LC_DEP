const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const attendanceService = require('./attendanceService');

// Make sure jspdf is loaded correctly in Node environment
let jsPDF;
try {
  const jspdfModule = require('jspdf');
  jsPDF = jspdfModule.jsPDF || jspdfModule;
} catch (e) {
  console.warn('[ExportService] jspdf module not loaded yet, will lazy load.');
}

// Ensure temp directory exists
const EXPORTS_DIR = path.resolve(__dirname, '../temp/exports');
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

/**
 * Fetch report data based on report type and filters.
 */
async function fetchReportData(reportType, filters) {
  const { department, section, academicBatch, startDate, endDate } = filters;

  if (reportType === 'contests') {
    let sql = '';
    let params = [];
    if (academicBatch) {
      sql = `
        SELECT c.title as name, c.slug as contest_slug, c.contest_status, c.start_time as date, c.duration,
               c.contest_type as type,
               (SELECT COUNT(*) FROM Users WHERE status = 'active' AND academic_batch = ?) as total_students,
               (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Users u ON ar.user_id = u.id WHERE ar.contest_id = c.contest_id AND u.academic_batch = ? AND ar.attendance_status = 'PRESENT') as present_count,
               (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Users u ON ar.user_id = u.id WHERE ar.contest_id = c.contest_id AND u.academic_batch = ? AND ar.attendance_status = 'ABSENT') as absent_count,
               0 as not_applicable_count,
               IFNULL(ROUND(
                 (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Users u ON ar.user_id = u.id WHERE ar.contest_id = c.contest_id AND u.academic_batch = ? AND ar.attendance_status = 'PRESENT') /
                 NULLIF((SELECT COUNT(*) FROM AttendanceRecords ar JOIN Users u ON ar.user_id = u.id WHERE ar.contest_id = c.contest_id AND u.academic_batch = ? AND ar.attendance_status IN ('PRESENT', 'ABSENT')), 0) * 100
               ), 0) as attendance_percentage
        FROM Contests c
        WHERE c.contest_status != 'Cancelled'
        ORDER BY c.start_time DESC
      `;
      params = [academicBatch, academicBatch, academicBatch, academicBatch, academicBatch];
    } else {
      sql = `
        SELECT c.contest_id, c.title as name, c.slug as contest_slug, c.contest_status, c.start_time as date, c.duration,
               c.contest_type as type,
               (SELECT COUNT(*) FROM Users WHERE status = 'active') as total_students,
               (SELECT COUNT(*) FROM AttendanceRecords ar WHERE ar.contest_id = c.contest_id AND ar.attendance_status = 'PRESENT') as present_count,
               (SELECT COUNT(*) FROM AttendanceRecords ar WHERE ar.contest_id = c.contest_id AND ar.attendance_status = 'ABSENT') as absent_count,
               0 as not_applicable_count,
               IFNULL(ROUND(
                 (SELECT COUNT(*) FROM AttendanceRecords ar WHERE ar.contest_id = c.contest_id AND ar.attendance_status = 'PRESENT') /
                 NULLIF((SELECT COUNT(*) FROM AttendanceRecords ar WHERE ar.contest_id = c.contest_id AND ar.attendance_status IN ('PRESENT', 'ABSENT')), 0) * 100
               ), 0) as attendance_percentage
        FROM Contests c
        WHERE c.contest_status != 'Cancelled'
        ORDER BY c.start_time DESC
      `;
    }
    return await db.query(sql, params);
  }

  if (reportType === 'students') {
    let data = await attendanceService.getBatchAttendanceSummary({ department, section, academicBatch });
    
    // Enrich with platform profile ratings
    const studentIds = data.map(s => s.id);
    if (studentIds.length > 0) {
      const idPlaceholders = studentIds.map(() => '?').join(',');
      const lcProfiles = await db.query(`SELECT user_id, current_rating, highest_rating, global_ranking, problems_solved FROM LeetCodeProfiles WHERE user_id IN (${idPlaceholders})`, studentIds);
      const ccProfiles = await db.query(`SELECT user_id, current_rating, highest_rating FROM CodeChefProfiles WHERE user_id IN (${idPlaceholders})`, studentIds);
      const cfProfiles = await db.query(`SELECT user_id, current_rating, highest_rating FROM CodeforcesProfiles WHERE user_id IN (${idPlaceholders})`, studentIds);
      
      const lcMap = new Map(lcProfiles.map(p => [p.user_id, p]));
      const ccMap = new Map(ccProfiles.map(p => [p.user_id, p]));
      const cfMap = new Map(cfProfiles.map(p => [p.user_id, p]));
      
      data = data.map(s => {
        const lc = lcMap.get(s.id) || {};
        const cc = ccMap.get(s.id) || {};
        const cf = cfMap.get(s.id) || {};
        
        // Find best rating across all
        const currentRating = Math.max(lc.current_rating || 0, cc.current_rating || 0, cf.current_rating || 0) || 1500;
        const bestRating = Math.max(lc.highest_rating || 0, cc.highest_rating || 0, cf.highest_rating || 0) || 1500;

        return {
          ...s,
          register_number: s.roll_no,
          academic_year: s.academic_batch,
          rated_contests: s.total_eligible,
          unrated_contests: 0,
          present_count: s.attended_count,
          current_rating: currentRating,
          best_rating: bestRating,
          rank_history: lc.global_ranking || 'N/A'
        };
      });
    }
    return data;
  }

  if (reportType === 'departments') {
    const stats = await db.query(
      `SELECT u.department,
              COUNT(DISTINCT u.id) as total_students,
              (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Users u2 ON ar.user_id = u2.id
               WHERE u2.department = u.department AND u2.status = 'active') as total_records,
              (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Users u2 ON ar.user_id = u2.id
               WHERE u2.department = u.department AND u2.status = 'active' AND ar.attendance_status = 'PRESENT') as present_count,
              IFNULL(ROUND(AVG(lp.current_rating)), 0) as avg_lc_rating,
              IFNULL(ROUND(MAX(lp.highest_rating)), 0) as peak_lc_rating,
              IFNULL(ROUND(AVG(cp.current_rating)), 0) as avg_cc_rating,
              IFNULL(ROUND(MAX(cp.highest_rating)), 0) as peak_cc_rating,
              IFNULL(ROUND(AVG(cfp.current_rating)), 0) as avg_cf_rating,
              IFNULL(ROUND(MAX(cfp.highest_rating)), 0) as peak_cf_rating
       FROM Users u
       LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
       LEFT JOIN CodeChefProfiles cp ON u.id = cp.user_id
       LEFT JOIN CodeforcesProfiles cfp ON u.id = cfp.user_id
       WHERE u.status = 'active'
       GROUP BY u.department`
    );

    return stats.map(s => {
      const total = Number(s.total_records);
      const present = Number(s.present_count);
      const ratings = [s.avg_lc_rating, s.avg_cc_rating, s.avg_cf_rating].map(Number).filter(r => r > 0);
      const averageRating = ratings.length > 0 ? Math.round(ratings.reduce((sum, val) => sum + val, 0) / ratings.length) : 0;
      const peakRating = Math.max(
        Number(s.peak_lc_rating || 0),
        Number(s.peak_cc_rating || 0),
        Number(s.peak_cf_rating || 0)
      );
      return {
        department: s.department,
        total_students: Number(s.total_students),
        attendance_percentage: total > 0 ? Math.round((present / total) * 100) : 0,
        average_rating: averageRating,
        peak_rating: peakRating
      };
    });
  }

  if (reportType === 'sections') {
    let sql = `
      SELECT u.department, u.section,
             CONCAT(u.department, ' - ', u.section) as section_label,
             COUNT(DISTINCT u.id) as total_students,
             (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Users u2 ON ar.user_id = u2.id
              WHERE u2.department = u.department AND u2.section = u.section AND u2.status = 'active') as total_records,
             (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Users u2 ON ar.user_id = u2.id
              WHERE u2.department = u.department AND u2.section = u.section AND u2.status = 'active' AND ar.attendance_status = 'PRESENT') as present_count,
             IFNULL(ROUND(AVG(lp.current_rating)), 0) as avg_lc_rating,
             IFNULL(ROUND(AVG(cp.current_rating)), 0) as avg_cc_rating,
             IFNULL(ROUND(AVG(cfp.current_rating)), 0) as avg_cf_rating
      FROM Users u
      LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
      LEFT JOIN CodeChefProfiles cp ON u.id = cp.user_id
      LEFT JOIN CodeforcesProfiles cfp ON u.id = cfp.user_id
      WHERE u.status = 'active'
    `;
    const params = [];
    if (department) { sql += ' AND u.department = ?'; params.push(department); }
    sql += ' GROUP BY u.department, u.section ORDER BY u.department, u.section';
    
    const rows = await db.query(sql, params);
    return rows.map(s => {
      const total = Number(s.total_records);
      const present = Number(s.present_count);
      const ratings = [s.avg_lc_rating, s.avg_cc_rating, s.avg_cf_rating].map(Number).filter(r => r > 0);
      const averageRating = ratings.length > 0 ? Math.round(ratings.reduce((sum, val) => sum + val, 0) / ratings.length) : 0;
      return {
        department: s.department,
        section: s.section,
        section_label: s.section_label,
        total_students: Number(s.total_students),
        attendance_percentage: total > 0 ? Math.round((present / total) * 100) : 0,
        average_rating: averageRating
      };
    });
  }

  if (reportType === 'attendance-log') {
    let sql = `
      SELECT ar.id, ar.user_id, ar.contest_id, ar.attendance_status, ar.attendance_source,
             u.name as student_name, u.roll_no as register_number, u.department, u.section,
             c.title as contest_name, c.start_time as contest_date, c.contest_status
      FROM AttendanceRecords ar
      JOIN Users u ON u.id = ar.user_id
      JOIN Contests c ON c.contest_id = ar.contest_id
      WHERE 1=1
    `;
    const params = [];
    if (academicBatch) { sql += ' AND u.academic_batch = ?'; params.push(academicBatch); }
    if (department) { sql += ' AND u.department = ?'; params.push(department); }
    if (section) { sql += ' AND u.section = ?'; params.push(section); }
    sql += ' ORDER BY ar.last_updated DESC LIMIT 500';
    return await db.query(sql, params);
  }

  return [];
}

/**
 * Generate PDF, Excel, or CSV report and save it to backend/temp/exports.
 */
async function generateReport(jobId, format, reportType, filters, updateProgress) {
  updateProgress(15, 'Fetching report data from database...');
  const data = await fetchReportData(reportType, filters);
  
  updateProgress(45, `Data retrieved: ${data.length} records. Generating ${format.toUpperCase()} file...`);
  const XLSX = require('xlsx');

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `${reportType}_report_${timestamp}.${format === 'excel' ? 'xlsx' : format === 'pdf' ? 'pdf' : 'csv'}`;
  const filePath = path.join(EXPORTS_DIR, `export_${jobId}.${format === 'excel' ? 'xlsx' : format === 'pdf' ? 'pdf' : 'csv'}`);

  if (format === 'excel' || format === 'csv') {
    const ws = XLSX.utils.json_to_sheet(data);
    
    if (format === 'excel') {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Report Data');
      XLSX.writeFile(wb, filePath);
    } else {
      const csvOutput = XLSX.utils.sheet_to_csv(ws);
      fs.writeFileSync(filePath, csvOutput, 'utf8');
    }
  } else if (format === 'pdf') {
    if (!jsPDF) {
      const jspdfModule = require('jspdf');
      jsPDF = jspdfModule.jsPDF || jspdfModule;
    }
    // Load autotable for node environment
    require('jspdf-autotable');

    const doc = new jsPDF({
      orientation: (reportType === 'students') ? 'landscape' : 'portrait'
    });

    const title = `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Attendance Report`;
    doc.setFontSize(14);
    doc.text(title, 14, 15);
    doc.setFontSize(8);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 20);

    let headers = [];
    let rows = [];

    if (reportType === 'contests') {
      headers = ['Contest Name', 'Slug', 'Status', 'Date', 'Present', 'Absent', 'Attendance %'];
      rows = data.map(c => [
        c.name,
        c.contest_slug,
        c.contest_status,
        new Date(c.date).toLocaleDateString(),
        c.present_count,
        c.absent_count,
        `${c.attendance_percentage}%`
      ]);
    } else if (reportType === 'students') {
      headers = ['Roll Number', 'Student Name', 'Dept', 'Year', 'LeetCode Username', 'Present', 'Attendance %', 'Rating', 'Best Rating'];
      rows = data.map(s => [
        s.register_number,
        s.name,
        s.department,
        s.academic_year,
        s.leetcode_username,
        s.present_count,
        `${s.attendance_percentage}%`,
        s.current_rating,
        s.best_rating
      ]);
    } else if (reportType === 'departments') {
      headers = ['Department', 'Total Students', 'Agg. Present Count', 'Attendance %'];
      rows = data.map(d => [
        d.department,
        d.total_students,
        d.present_count,
        `${d.attendance_percentage || 0}%`
      ]);
    } else if (reportType === 'sections') {
      headers = ['Department', 'Section', 'Total Students', 'Agg. Present Count', 'Attendance %'];
      rows = data.map(s => [
        s.department,
        s.section,
        s.total_students,
        s.present_count,
        `${s.attendance_percentage || 0}%`
      ]);
    } else if (reportType === 'attendance-log') {
      headers = ['Roll Number', 'Student Name', 'Dept', 'Sec', 'Contest Name', 'Contest Date', 'Attendance Status'];
      rows = data.map(item => [
        item.register_number,
        item.student_name,
        item.department,
        item.section,
        item.contest_name,
        new Date(item.contest_date).toLocaleDateString(),
        item.attendance_status
      ]);
    }

    doc.autoTable({
      head: [headers],
      body: rows,
      startY: 23,
      theme: 'grid',
      styles: { fontSize: 7 }
    });

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    fs.writeFileSync(filePath, pdfBuffer);
  }

  updateProgress(100, 'Report generation completed');

  return {
    filename,
    filePath,
    mimeType: format === 'excel'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : format === 'pdf'
      ? 'application/pdf'
      : 'text/csv'
  };
}

module.exports = {
  generateReport,
  EXPORTS_DIR
};
