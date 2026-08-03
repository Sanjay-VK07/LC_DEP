/**
 * Frontend Contest Metrics Utility
 * Ensures all metrics, rates, and progress widths are mathematically valid and accurate.
 */

export function safeNumber(val, defaultVal = 0) {
  if (val === null || val === undefined) return defaultVal;
  const num = Number(val);
  if (isNaN(num) || !isFinite(num) || num < 0) return defaultVal;
  return num;
}

export function calculateAttendanceRate(attendedInput, registrationsInput, options = {}) {
  const att = safeNumber(attendedInput, 0);
  const reg = safeNumber(registrationsInput, 0);

  if (reg === 0) {
    return {
      rate: 0,
      displayRate: 'N/A',
      percentage: 0,
      isZeroReg: true,
      hasWarning: false,
      attended: att,
      registrations: 0
    };
  }

  const rawRate = (att / reg) * 100;
  let isOver = false;

  if (process.env.NODE_ENV !== 'production' && att > reg) {
    console.warn(`[ContestMaster Dev Diagnostic] Inconsistent Metrics Warning: Attended (${att}) > Registrations (${reg}).
      Contest ID: ${options.contestId || 'N/A'}
      Contest Slug: ${options.contestSlug || 'N/A'}
      Calculated Rate: ${rawRate.toFixed(1)}%`);
    isOver = true;
  }

  const clampedRate = Math.min(100.0, Math.max(0.0, safeNumber(rawRate, 0)));
  const formattedRate = `${parseFloat(clampedRate.toFixed(1))}%`;

  return {
    rate: parseFloat(clampedRate.toFixed(1)),
    displayRate: formattedRate,
    percentage: clampedRate,
    isZeroReg: false,
    hasWarning: isOver,
    attended: att,
    registrations: reg
  };
}

export function calculateProgress(rateInput) {
  const num = safeNumber(rateInput, 0);
  return Math.min(100.0, Math.max(0.0, num));
}

export function formatRate(rateInput, isZeroReg = false) {
  if (isZeroReg) return 'N/A';
  const num = safeNumber(rateInput, 0);
  const clamped = Math.min(100.0, Math.max(0.0, num));
  return `${parseFloat(clamped.toFixed(1))}%`;
}
