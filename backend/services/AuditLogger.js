const AuditLogger = {
  log({ severity, contestId, contestSlug, userId, username, issue, expected, actual, action, workerId = null, page = null }) {
    const logObj = {
      timestamp: new Date().toISOString(),
      requestId: process.env.REQUEST_ID || null,
      workerId,
      service: 'ContestMaster',
      contestId: contestId || null,
      contestSlug: contestSlug || null,
      page,
      userId: userId || null,
      username: username || null,
      severity,
      issue,
      expected: expected || null,
      actual: actual || null,
      action
    };
    
    const message = `[AUDIT] ${JSON.stringify(logObj, null, 2)}`;
    if (severity === 'FATAL' || severity === 'ERROR') {
      console.error(message);
    } else {
      console.warn(message);
    }
  },

  info(opts) { this.log({ ...opts, severity: 'INFO' }); },
  warn(opts) { this.log({ ...opts, severity: 'WARNING' }); },
  error(opts) { this.log({ ...opts, severity: 'ERROR' }); },
  fatal(opts) { this.log({ ...opts, severity: 'FATAL' }); }
};

module.exports = AuditLogger;
