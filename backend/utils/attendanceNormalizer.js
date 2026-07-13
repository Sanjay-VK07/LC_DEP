function normalizeAttendanceStatus(status) {
  if (!status) return 'ABSENT';
  const s = status.trim().toUpperCase();
  if (s === 'PRESENT' || s === 'PRESENT ✅' || s === 'PARTICIPATING') return 'PRESENT';
  if (s === 'ABSENT' || s === 'ABSENT ❌' || s === 'UNKNOWN' || s === 'PENDING') return 'ABSENT';
  return s;
}

module.exports = {
  normalizeAttendanceStatus
};
