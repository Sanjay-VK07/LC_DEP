/**
 * Base abstract class for all Attendance Providers.
 * Defines the contract that every attendance provider must implement.
 */
class AttendanceProvider {
  /**
   * @param {string} providerName - Identifier for the provider (e.g., 'GRAPHQL', 'CSV', 'LEGACY')
   */
  constructor(providerName) {
    if (new.target === AttendanceProvider) {
      throw new TypeError('Cannot construct AttendanceProvider abstract instances directly');
    }
    this.providerName = providerName;
  }

  /**
   * Resolve contest attendance for a single student or batch of students.
   * @param {object} options
   * @param {string} options.contestSlug - Target contest slug (e.g. 'weekly-contest-400')
   * @param {Array<object>} options.students - Array of student objects { id, leetcode_username, name, roll_no }
   * @returns {Promise<Array<object>>} - Array of attendance result items:
   *   { studentId, username, contestSlug, attended, rank, score, problemsSolved, totalProblems, finishTime, rating, ratingChange, status, source, provider, rawData }
   */
  async resolveAttendance({ contestSlug, students = [] }) {
    throw new Error(`[AttendanceProvider] resolveAttendance() must be implemented by subclass ${this.constructor.name}`);
  }

  /**
   * Health check for the provider.
   * @returns {Promise<{available: boolean, provider: string, message?: string}>}
   */
  async checkHealth() {
    return { available: true, provider: this.providerName };
  }
}

module.exports = AttendanceProvider;
