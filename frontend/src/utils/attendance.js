export function normalizeAttendanceStatus(status) {
  if (!status) return 'NOT_VERIFIED';
  const s = status.trim().toUpperCase();
  if (s === 'PRESENT' || s === 'PRESENT ✅' || s === 'PARTICIPATING') return 'PRESENT';
  if (s === 'ABSENT' || s === 'ABSENT ❌') return 'ABSENT';
  if (s === 'UNKNOWN' || s === 'PENDING' || s === 'NOT_VERIFIED' || s === 'NOT VERIFIED') return 'NOT_VERIFIED';
  return s;
}

