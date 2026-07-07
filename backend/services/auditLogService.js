/**
 * AuditLogService
 * ===============
 * Logs all system operations to the database AuditLog table.
 * Falls back to console logging if DB is unavailable.
 */

const db = require('../config/db');

const AUDIT_ACTIONS = {
  SYNC_STARTED: 'SYNC_STARTED',
  SYNC_COMPLETED: 'SYNC_COMPLETED',
  SYNC_FAILED: 'SYNC_FAILED',
  ATTENDANCE_UPDATED: 'ATTENDANCE_UPDATED',
  ATTENDANCE_OVERRIDE: 'ATTENDANCE_OVERRIDE',
  STUDENT_CREATED: 'STUDENT_CREATED',
  STUDENT_UPDATED: 'STUDENT_UPDATED',
  STUDENT_DELETED: 'STUDENT_DELETED',
  CONTEST_CREATED: 'CONTEST_CREATED',
  CONTEST_UPDATED: 'CONTEST_UPDATED',
  CONTEST_DELETED: 'CONTEST_DELETED',
  PROFILE_VERIFIED: 'PROFILE_VERIFIED',
  PROFILE_SYNCED: 'PROFILE_SYNCED',
  REPORT_GENERATED: 'REPORT_GENERATED',
  CACHE_INVALIDATED: 'CACHE_INVALIDATED',
  MIGRATION_EXECUTED: 'MIGRATION_EXECUTED',
  JOB_ENQUEUED: 'JOB_ENQUEUED',
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_FAILED: 'JOB_FAILED'
};

let tableExists = null;

async function ensureTableExists() {
  if (tableExists === true) return true;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS AuditLog (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        action VARCHAR(100) NOT NULL,
        actor VARCHAR(255) DEFAULT 'SYSTEM',
        target_type VARCHAR(100) DEFAULT NULL,
        target_id VARCHAR(255) DEFAULT NULL,
        details LONGTEXT DEFAULT NULL,
        severity ENUM('INFO','WARNING','ERROR') DEFAULT 'INFO',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_action (action),
        INDEX idx_audit_created (created_at),
        INDEX idx_audit_severity (severity)
      ) ENGINE=InnoDB
    `);
    tableExists = true;
    return true;
  } catch (err) {
    console.warn('[AuditLog] Could not ensure AuditLog table:', err.message);
    tableExists = false;
    return false;
  }
}

/**
 * Log an audit event.
 * @param {string} action - One of AUDIT_ACTIONS or any custom string
 * @param {object} opts
 * @param {string} opts.actor - Who triggered the action (default: 'SYSTEM')
 * @param {string} opts.targetType - e.g. 'student', 'contest'
 * @param {string|number} opts.targetId
 * @param {object|string} opts.details - Arbitrary details (will be JSON stringified if object)
 * @param {string} opts.severity - 'INFO' | 'WARNING' | 'ERROR'
 */
async function log(action, { actor = 'SYSTEM', targetType = null, targetId = null, details = null, severity = 'INFO' } = {}) {
  const detailsStr = details
    ? (typeof details === 'string' ? details : JSON.stringify(details))
    : null;

  console.log(`[Audit] [${severity}] ${action} | actor=${actor} target=${targetType}:${targetId} | ${detailsStr ? detailsStr.substring(0, 120) : ''}`);

  try {
    const ok = await ensureTableExists();
    if (!ok) return;
    await db.query(
      `INSERT INTO AuditLog (action, actor, target_type, target_id, details, severity) VALUES (?, ?, ?, ?, ?, ?)`,
      [action, actor, targetType, targetId !== null ? String(targetId) : null, detailsStr, severity]
    );
  } catch (err) {
    console.warn('[AuditLog] Failed to write audit log:', err.message);
  }
}

/**
 * Query recent audit logs.
 * @param {object} filters - { action?, severity?, limit? }
 */
async function getLogs({ action, severity, limit = 100 } = {}) {
  try {
    const ok = await ensureTableExists();
    if (!ok) return [];
    let sql = 'SELECT * FROM AuditLog WHERE 1=1';
    const params = [];
    if (action) { sql += ' AND action = ?'; params.push(action); }
    if (severity) { sql += ' AND severity = ?'; params.push(severity); }
    const safeLimit = Number.parseInt(limit, 10) || 100;
    if (!Number.isInteger(safeLimit) || safeLimit <= 0) {
      throw new Error("Invalid limit");
    }

    sql += ` ORDER BY created_at DESC LIMIT ${safeLimit}`;
    return await db.query(sql, params);
  } catch (err) {
    console.warn('[AuditLog] Failed to query audit logs:', err.message);
    return [];
  }
}

module.exports = {
  log,
  getLogs,
  AUDIT_ACTIONS
};
