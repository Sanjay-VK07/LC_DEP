/**
 * Repository responsible ONLY for HandleVerifications database operations.
 * Uses parameterized queries to prevent SQL injection.
 */
const db = require('../config/db');

class VerificationRepository {
  /**
   * Find verification by platform and normalized username
   */
  static async findByPlatformAndUsername(platform, usernameNormalized, conn = null) {
    if (!platform || !usernameNormalized) return null;
    const queryFn = conn ? (sql, params) => conn.query(sql, params) : (sql, params) => db.query(sql, params);

    const sql = `
      SELECT id, user_id, platform, username_original, username_normalized,
             verification_status, verification_source, verified_at, verification_expiry,
             last_error, created_at, updated_at
      FROM HandleVerifications
      WHERE platform = ? AND username_normalized = ?
      LIMIT 1
    `;

    try {
      const rows = await queryFn(sql, [platform.toLowerCase().trim(), usernameNormalized.toLowerCase().trim()]);
      return rows && rows.length > 0 ? rows[0] : null;
    } catch (err) {
      console.warn(`[VerificationRepository] findByPlatformAndUsername error: ${err.message}`);
      return null;
    }
  }

  /**
   * Upsert a single verification record
   */
  static async upsertVerification(record, conn = null) {
    const {
      userId = null,
      platform,
      usernameOriginal,
      usernameNormalized,
      verificationStatus = 'UNVERIFIED',
      verificationSource = 'API',
      verifiedAt = null,
      verificationExpiry = null,
      lastError = null
    } = record;

    if (!platform || !usernameNormalized) return false;
    const queryFn = conn ? (sql, params) => conn.query(sql, params) : (sql, params) => db.query(sql, params);

    const sql = `
      INSERT INTO HandleVerifications (
        user_id, platform, username_original, username_normalized,
        verification_status, verification_source, verified_at, verification_expiry, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        user_id = IFVALUES(user_id, user_id),
        username_original = VALUES(username_original),
        verification_status = VALUES(verification_status),
        verification_source = VALUES(verification_source),
        verified_at = VALUES(verified_at),
        verification_expiry = VALUES(verification_expiry),
        last_error = VALUES(last_error),
        updated_at = CURRENT_TIMESTAMP
    `;

    // Note: standard MySQL syntax uses VALUES() or aliases. We use explicit UPDATE expressions.
    const sqlCompatible = `
      INSERT INTO HandleVerifications (
        user_id, platform, username_original, username_normalized,
        verification_status, verification_source, verified_at, verification_expiry, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        user_id = COALESCE(VALUES(user_id), user_id),
        username_original = VALUES(username_original),
        verification_status = VALUES(verification_status),
        verification_source = VALUES(verification_source),
        verified_at = VALUES(verified_at),
        verification_expiry = VALUES(verification_expiry),
        last_error = VALUES(last_error),
        updated_at = CURRENT_TIMESTAMP
    `;

    try {
      await queryFn(sqlCompatible, [
        userId,
        platform.toLowerCase().trim(),
        usernameOriginal || usernameNormalized,
        usernameNormalized.toLowerCase().trim(),
        verificationStatus,
        verificationSource,
        verifiedAt,
        verificationExpiry,
        lastError
      ]);
      return true;
    } catch (err) {
      console.error(`[VerificationRepository] upsertVerification error: ${err.message}`);
      return false;
    }
  }

  /**
   * Batch upsert multiple verification records
   */
  static async batchUpsertVerifications(records = [], conn = null) {
    if (!records || records.length === 0) return true;
    for (const record of records) {
      await this.upsertVerification(record, conn);
    }
    return true;
  }

  /**
   * Invalidate cache (set status to EXPIRED and clear expiry timestamp)
   */
  static async invalidateCache(platform, usernameNormalized, conn = null) {
    if (!platform || !usernameNormalized) return false;
    const queryFn = conn ? (sql, params) => conn.query(sql, params) : (sql, params) => db.query(sql, params);

    const sql = `
      UPDATE HandleVerifications
      SET verification_status = 'EXPIRED', verification_expiry = NOW()
      WHERE platform = ? AND username_normalized = ?
    `;

    try {
      await queryFn(sql, [platform.toLowerCase().trim(), usernameNormalized.toLowerCase().trim()]);
      return true;
    } catch (err) {
      console.warn(`[VerificationRepository] invalidateCache error: ${err.message}`);
      return false;
    }
  }

  /**
   * Refresh cache entry with new expiry date
   */
  static async refreshCache(platform, usernameNormalized, expiryDate, conn = null) {
    if (!platform || !usernameNormalized) return false;
    const queryFn = conn ? (sql, params) => conn.query(sql, params) : (sql, params) => db.query(sql, params);

    const sql = `
      UPDATE HandleVerifications
      SET verification_status = 'VERIFIED', verified_at = NOW(), verification_expiry = ?, last_error = NULL
      WHERE platform = ? AND username_normalized = ?
    `;

    try {
      await queryFn(sql, [expiryDate, platform.toLowerCase().trim(), usernameNormalized.toLowerCase().trim()]);
      return true;
    } catch (err) {
      console.warn(`[VerificationRepository] refreshCache error: ${err.message}`);
      return false;
    }
  }
}

module.exports = VerificationRepository;
