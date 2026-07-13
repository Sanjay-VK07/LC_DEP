const { normalizeHandle } = require('./normalizationService');
const { getAdapter } = require('./adapters/AdapterFactory');
const db = require('../config/db');

class CodeforcesVerificationService {
  /**
   * Normalizes the handle
   */
  normalize(handle) {
    return normalizeHandle(handle);
  }

  /**
   * Checks if a handle is already in use by another user
   * @returns {Promise<boolean>} true if duplicate exists
   */
  async checkDuplicate(handle, currentUserId = null) {
    const normalized = this.normalize(handle);
    if (!normalized) return false;

    let sql = 'SELECT id FROM Users WHERE codeforces_username_normalized = ?';
    const params = [normalized];

    if (currentUserId !== null) {
      sql += ' AND id != ?';
      params.push(currentUserId);
    }

    const rows = await db.query(sql, params);
    return rows.length > 0;
  }

  /**
   * Verifies the handle with the Codeforces API
   */
  async verifyWithApi(handle) {
    const adapter = getAdapter('codeforces');
    const result = await adapter.getProfile(handle);
    if (!result || !result.verified) {
      throw new Error(result?.message || 'Invalid Codeforces Handle');
    }
    return result; // contains canonical username, rating, rank, maxRating, maxRank, rawData
  }

  /**
   * Dedicated verification logic outside of transaction boundaries
   */
  async verifyHandle(handle, currentUserId = null) {
    const normalized = this.normalize(handle);
    if (!normalized) {
      return {
        username: null,
        normalized: null,
        verified: 0,
        verifiedAt: null,
        verifiedSource: null,
        rating: null,
        rank: null,
        maxRank: null
      };
    }

    // Uniqueness check
    const isDup = await this.checkDuplicate(handle, currentUserId);
    if (isDup) {
      const err = new Error('Codeforces username already in use by another student.');
      err.statusCode = 409;
      throw err;
    }

    // Call Codeforces API
    const apiResult = await this.verifyWithApi(handle);
    
    return {
      username: apiResult.username || handle,
      normalized,
      verified: 1,
      verifiedAt: new Date(),
      verifiedSource: 'MANUAL',
      rating: apiResult.rating || null,
      rank: apiResult.rank || null,
      maxRank: apiResult.metadata?.maxRank || null
    };
  }
}

module.exports = new CodeforcesVerificationService();
