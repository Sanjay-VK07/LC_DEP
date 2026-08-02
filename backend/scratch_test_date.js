function getLeetCodeOfficialStartTime(slug) {
  if (!slug) return null;
  const clean = slug.toLowerCase().trim();

  // Biweekly check FIRST
  const biweeklyMatch = clean.match(/biweekly-contest-(\d+)/);
  if (biweeklyMatch) {
    const n = parseInt(biweeklyMatch[1], 10);
    // Anchor: Biweekly Contest 135 = 2024-07-20 14:30:00 UTC (1721485800 sec)
    const sec = 1721485800 + (n - 135) * 1209600;
    return new Date(sec * 1000);
  }

  const weeklyMatch = clean.match(/weekly-contest-(\d+)/);
  if (weeklyMatch) {
    const n = parseInt(weeklyMatch[1], 10);
    // Anchor: Weekly Contest 512 = 2026-07-26 02:30:00 UTC (1785033000 sec)
    const sec = 1785033000 + (n - 512) * 604800;
    return new Date(sec * 1000);
  }

  return null;
}

console.log('Weekly 400:', getLeetCodeOfficialStartTime('weekly-contest-400')?.toISOString());
console.log('Weekly 512:', getLeetCodeOfficialStartTime('weekly-contest-512')?.toISOString());
console.log('Weekly 513:', getLeetCodeOfficialStartTime('weekly-contest-513')?.toISOString());
console.log('Biweekly 135:', getLeetCodeOfficialStartTime('biweekly-contest-135')?.toISOString());
console.log('Biweekly 136:', getLeetCodeOfficialStartTime('biweekly-contest-136')?.toISOString());
