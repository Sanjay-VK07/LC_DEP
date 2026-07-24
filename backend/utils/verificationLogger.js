/**
 * Structured Logger for Verification Framework & Bulk Import Ops
 */
const { ENABLE_STRUCTURED_LOGGING } = require('../config/verificationConfig');

function logEvent(eventType, details = {}) {
  if (!ENABLE_STRUCTURED_LOGGING) return;

  const payload = {
    timestamp: new Date().toISOString(),
    event: eventType,
    job_id: details.job_id || details.jobId || 'N/A',
    platform: details.platform || 'N/A',
    username: details.username || 'N/A',
    duration_ms: details.duration_ms ?? details.duration ?? 0,
    status: details.status || 'INFO',
    meta: details.meta || undefined
  };

  console.log(`[VERIFICATION_LOG] ${JSON.stringify(payload)}`);
}

module.exports = {
  logEvent
};
