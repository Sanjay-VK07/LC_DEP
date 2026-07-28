const AttendanceProvider = require('./AttendanceProvider');
const db = require('../../config/db');
const { normalizeUsername } = require('../../utils/usernameNormalizer');

class LegacyAttendanceProvider extends AttendanceProvider {
  constructor() {
    super('LEGACY');
  }

  async resolveAttendance({ contestSlug, students = [] }) {
    let cachedParticipants = [];
    try {
      cachedParticipants = await db.query(
        "SELECT username, `rank`, score, problems_solved, finish_time FROM ContestParticipants WHERE contest_slug = ?",
        [contestSlug]
      );
    } catch (err) {
      console.warn('[LegacyAttendanceProvider] ContestParticipants query skipped:', err.message);
    }

    const participantMap = new Map();
    for (const p of cachedParticipants) {
      const norm = normalizeUsername(p.username);
      if (norm) {
        participantMap.set(norm, p);
      }
    }

    const results = [];
    for (const student of students) {
      const normHandle = normalizeUsername(student.leetcode_username || student.username);
      const match = normHandle ? participantMap.get(normHandle) : null;

      if (match) {
        results.push({
          studentId: student.id,
          username: normHandle,
          contestSlug,
          attended: true,
          rank: match.rank || null,
          score: match.score ? parseFloat(match.score) : 0,
          problemsSolved: match.problems_solved || 0,
          totalProblems: 4,
          finishTime: match.finish_time || 0,
          rating: null,
          ratingChange: 0,
          status: 'PRESENT',
          source: 'LEGACY',
          provider: 'LEGACY',
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
          source: 'LEGACY',
          provider: 'LEGACY'
        });
      }
    }

    return results;
  }
}

module.exports = LegacyAttendanceProvider;
