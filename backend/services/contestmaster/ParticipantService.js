const db = require('../../config/db');
const legacyAttendanceService = require('../attendanceService');

/**
 * ParticipantService
 * Responsible ONLY for participant retrieval, pagination, searching, and batch filtering.
 */
class ParticipantService {
  /**
   * Fetches participants for a specific contest with pagination and filtering.
   */
  async getContestParticipants(contestId, { batch, search = '', page = 1, limit = 50 } = {}) {
    const result = await legacyAttendanceService.getContestParticipants(contestId, { batch });
    
    let participants = result.data || [];

    if (search) {
      const lower = search.toLowerCase();
      participants = participants.filter(p => 
        (p.name && p.name.toLowerCase().includes(lower)) ||
        (p.roll_no && p.roll_no.toLowerCase().includes(lower)) ||
        (p.username && p.username.toLowerCase().includes(lower))
      );
    }

    const total = participants.length;
    const startIndex = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const paginatedParticipants = participants.slice(startIndex, startIndex + parseInt(limit));

    return {
      success: true,
      contestId,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      attended: result.attended || [],
      missed: result.missed || [],
      participants: paginatedParticipants,
      validationStatus: result.validationStatus,
      validationIssues: result.validationIssues
    };
  }
}

module.exports = new ParticipantService();
