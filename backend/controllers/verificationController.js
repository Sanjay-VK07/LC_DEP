/**
 * Verification Controller - Phase 2 API Endpoints
 * (Architecture Stubs & Interfaces for REST verification endpoints)
 */
const PlatformValidator = require('../services/PlatformValidator');

class VerificationController {
  /**
   * GET /api/verification/:platform/:username
   * Query single verification status for a platform handle
   */
  static async getVerificationStatus(req, res) {
    const { platform, username } = req.params;
    try {
      const validator = new PlatformValidator();
      const result = await validator.verify(platform, username);
      return res.json({
        success: true,
        data: result
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/verification/refresh
   * Force refresh/re-verification of a platform handle
   */
  static async refreshVerification(req, res) {
    const { platform, username } = req.body;
    if (!platform || !username) {
      return res.status(400).json({ success: false, message: 'Platform and username required' });
    }
    try {
      const validator = new PlatformValidator();
      await validator.invalidateCache(platform, username);
      const result = await validator.verify(platform, username, { skipCache: true });
      return res.json({
        success: true,
        message: `Successfully refreshed verification for ${platform}:${username}`,
        data: result
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/verification/job/:jobId
   * Retrieve verification metrics / status for a specific import job
   */
  static async getJobVerificationStatus(req, res) {
    const { jobId } = req.params;
    try {
      const db = require('../config/db');
      const rows = await db.query(
        "SELECT * FROM BulkImportAuditLogs WHERE import_job_id = ? OR session_id = ? LIMIT 1",
        [jobId, jobId]
      );
      if (!rows || rows.length === 0) {
        return res.status(404).json({ success: false, message: `Import job ${jobId} not found` });
      }
      return res.json({
        success: true,
        data: rows[0]
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}

module.exports = VerificationController;
