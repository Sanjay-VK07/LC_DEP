const db = require('../../config/db');
const legacyAttendanceService = require('../attendanceService');

/**
 * AttendanceService
 * Responsible ONLY for attendance calculation, attendance percentages, registrations, and manual overrides.
 */
class AttendanceService {
  /**
   * Calculates platform aggregate attendance metrics.
   */
  async getMetrics(platform, studentId = 'all', filters = {}) {
    const data = await legacyAttendanceService.getPlatformAnalytics(platform, studentId, filters);
    return data.metrics || { eligible: 0, attended: 0, missed: 0, rate: 0.0, ongoing: 0 };
  }

  /**
   * Registers a student for a contest.
   */
  async registerStudent(studentId, contestId) {
    return await legacyAttendanceService.registerForContest(studentId, contestId);
  }

  /**
   * Marks a student present for an ongoing contest.
   */
  async joinContest(studentId, contestId) {
    return await legacyAttendanceService.joinContest(studentId, contestId);
  }

  /**
   * Records an administrative manual override.
   */
  async recordOverride(studentId, contestId, status, remarks = '') {
    const query = `
      INSERT INTO AttendanceRecords (user_id, contest_id, attendance_status, attendance_source, remarks, override_by, override_at)
      VALUES (?, ?, ?, 'MANUAL', ?, 'admin', NOW())
      ON DUPLICATE KEY UPDATE
        attendance_status = VALUES(attendance_status),
        attendance_source = 'MANUAL',
        remarks = VALUES(remarks),
        override_by = VALUES(override_by),
        override_at = VALUES(override_at)
    `;
    await db.query(query, [studentId, contestId, status, remarks]);
    return { success: true, message: 'Attendance override saved successfully.' };
  }
}

module.exports = new AttendanceService();
