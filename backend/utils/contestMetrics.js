/**
 * Backend Contest Metrics Utility
 * Sanitizes numeric data, calculates attendance rates from single snapshots,
 * and logs dev diagnostics for inconsistent source datasets.
 */

function safeNumber(val, defaultVal = 0) {
  if (val === null || val === undefined) return defaultVal;
  const num = Number(val);
  if (isNaN(num) || !isFinite(num) || num < 0) return defaultVal;
  return num;
}

function calculateContestSnapshotMetrics({
  registered,
  attended,
  contestId = 'N/A',
  contestSlug = 'N/A',
  verifiedOverParticipation = false
}) {
  const reg = safeNumber(registered, 0);
  const att = safeNumber(attended, 0);

  if (reg === 0) {
    return {
      registration_count: 0,
      attendance_count: att,
      attendance_rate: null,
      displayRate: 'N/A',
      percentage: 0,
      isZeroReg: true
    };
  }

  const rawRate = (att / reg) * 100;

  if (process.env.NODE_ENV !== 'production' && att > reg) {
    console.warn(`[ContestMaster Dev Diagnostic] Inconsistent Metrics Detected:
      Contest ID: ${contestId}
      Contest Slug: ${contestSlug}
      Registered: ${reg}
      Attended: ${att}
      Raw Rate: ${rawRate.toFixed(1)}%`);
  }
  const clampedRate = Math.min(100.0, Math.max(0.0, safeNumber(rawRate, 0)));
  const formattedRate = `${parseFloat(clampedRate.toFixed(1))}%`;

  return {
    registration_count: reg,
    attendance_count: att,
    attendance_rate: parseFloat(clampedRate.toFixed(1)),
    displayRate: formattedRate,
    percentage: clampedRate,
    isZeroReg: false
  };
}

module.exports = {
  safeNumber,
  calculateContestSnapshotMetrics
};
