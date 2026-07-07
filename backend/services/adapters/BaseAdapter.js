class BaseAdapter {
  constructor(platformName) {
    this.platformName = platformName;
  }

  /**
   * Fetch and return normalized profile stats.
   * @param {string} username - Competitive programming handle
   * @returns {Promise<object>} Normalized profile
   */
  async getProfile(username) {
    throw new Error('Method "getProfile(username)" must be implemented by subclasses.');
  }

  /**
   * Fetch contest history for a user handle.
   * @param {string} username - Handle
   * @returns {Promise<Array>} List of rating history entries
   */
  async getContestHistory(username) {
    throw new Error('Method "getContestHistory(username)" must be implemented by subclasses.');
  }

  /**
   * Fetch participants of a contest by ID or slug.
   * @param {string|number} contestId - ID or slug of the contest
   * @returns {Promise<Array>} List of participants
   */
  async getContestParticipants(contestId) {
    throw new Error('Method "getContestParticipants(contestId)" must be implemented by subclasses.');
  }

  /**
   * Fetch list of upcoming contests on the platform.
   * @returns {Promise<Array>} List of upcoming contests
   */
  async getUpcomingContests() {
    throw new Error('Method "getUpcomingContests()" must be implemented by subclasses.');
  }
}

module.exports = BaseAdapter;
