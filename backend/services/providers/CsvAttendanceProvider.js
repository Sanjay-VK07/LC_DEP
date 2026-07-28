const AttendanceProvider = require('./AttendanceProvider');
const { normalizeUsername } = require('../../utils/usernameNormalizer');

class CsvAttendanceProvider extends AttendanceProvider {
  constructor(parsedRecords = []) {
    super('CSV');
    this.parsedRecords = parsedRecords;
  }

  /**
   * Set or update parsed CSV records.
   * @param {Array<object>} records - Array of parsed objects from CSV/XLSX:
   *   { username/roll_no, rank, score, problems_solved, attendance_status, ... }
   */
  setRecords(records) {
    this.parsedRecords = Array.isArray(records) ? records : [];
  }

  /**
   * Resolve attendance by matching CSV rows against student records.
   * @param {object} options
   * @param {string} options.contestSlug
   * @param {Array<object>} options.students
   * @returns {Promise<Array<object>>}
   */
  async resolveAttendance({ contestSlug, students = [] }) {
    const csvMap = new Map();

    for (const row of this.parsedRecords) {
      const handle = normalizeUsername(row.username || row.leetcode_username || row.handle || row.roll_no);
      if (handle) {
        csvMap.set(handle.toLowerCase(), row);
      }
      if (row.roll_no) {
        csvMap.set(String(row.roll_no).trim().toLowerCase(), row);
      }
    }

    const results = [];

    for (const student of students) {
      const normHandle = normalizeUsername(student.leetcode_username || student.username) || '';
      const rollNo = String(student.roll_no || '').trim().toLowerCase();

      const match = csvMap.get(normHandle.toLowerCase()) || (rollNo ? csvMap.get(rollNo) : null);

      if (match) {
        const rawStatus = (match.attendance_status || match.status || 'PRESENT').toUpperCase();
        const isPresent = rawStatus === 'PRESENT' || rawStatus === 'ATTENDED' || Boolean(match.attended);

        results.push({
          studentId: student.id,
          username: normHandle || student.leetcode_username,
          contestSlug,
          attended: isPresent,
          rank: match.rank ? parseInt(match.rank, 10) : null,
          score: match.score ? parseFloat(match.score) : (match.problems_solved ? parseFloat(match.problems_solved) * 5 : 0),
          problemsSolved: match.problems_solved ? parseInt(match.problems_solved, 10) : (match.score ? Math.floor(parseFloat(match.score) / 5) : 0),
          totalProblems: 4,
          finishTime: match.finish_time ? parseInt(match.finish_time, 10) : 0,
          rating: match.rating ? parseInt(match.rating, 10) : null,
          ratingChange: match.rating_change ? parseInt(match.rating_change, 10) : 0,
          status: isPresent ? 'PRESENT' : 'ABSENT',
          source: 'CSV_IMPORT',
          provider: 'CSV',
          rawData: match
        });
      } else {
        results.push({
          studentId: student.id,
          username: normHandle || student.leetcode_username,
          contestSlug,
          attended: false,
          rank: null,
          score: 0,
          problemsSolved: 0,
          totalProblems: 4,
          finishTime: 0,
          rating: null,
          ratingChange: 0,
          status: 'ABSENT',
          source: 'CSV_IMPORT',
          provider: 'CSV'
        });
      }
    }

    return results;
  }
}

module.exports = CsvAttendanceProvider;
