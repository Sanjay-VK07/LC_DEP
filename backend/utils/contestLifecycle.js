/**
 * Central utility to determine contest lifecycle state and official start times.
 * This is the Centralized Source of Truth for contest state across the application.
 */

/**
 * Calculates the exact official start time for a LeetCode Weekly or Biweekly Contest.
 * - Weekly Contest N: Every Sunday at 02:30:00 UTC (08:00 AM IST)
 * - Biweekly Contest N: Every alternate Saturday at 14:30:00 UTC (08:00 PM IST)
 *
 * @param {string} slug - Contest slug (e.g. 'weekly-contest-512' or 'biweekly-contest-135')
 * @returns {Date|null} - Exact official start Date in UTC
 */
function getLeetCodeOfficialStartTime(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const clean = slug.toLowerCase().trim();

  // Biweekly Contest Check FIRST (must precede weekly check because 'biweekly' contains 'weekly')
  const biweeklyMatch = clean.match(/biweekly-contest-(\d+)/);
  if (biweeklyMatch) {
    const n = parseInt(biweeklyMatch[1], 10);
    // Anchor: Biweekly Contest 135 = 2024-07-20 14:30:00 UTC (1721485800 seconds)
    const sec = 1721485800 + (n - 135) * 1209600;
    const d = new Date(sec * 1000);
    if (isNaN(d.getTime()) || d.getFullYear() > 2100 || d.getFullYear() < 2010) {
      return null;
    }
    return d;
  }

  const weeklyMatch = clean.match(/weekly-contest-(\d+)/);
  if (weeklyMatch) {
    const n = parseInt(weeklyMatch[1], 10);
    // Anchor: Weekly Contest 512 = 2026-07-26 02:30:00 UTC (1785033000 seconds)
    const sec = 1785033000 + (n - 512) * 604800;
    const d = new Date(sec * 1000);
    if (isNaN(d.getTime()) || d.getFullYear() > 2100 || d.getFullYear() < 2010) {
      return null;
    }
    return d;
  }

  return null;
}

function getContestStatus(contest) {
  if (!contest) {
    return {
      status: "FINISHED",
      attendanceAvailable: true,
      hasLeaderboard: true,
      canSyncAttendance: true,
      canCalculateAnalytics: true,
      contestEnded: true
    };
  }

  const now = new Date();

  // 1. Resolve Start Time
  let startTimeVal = contest.start_time || contest.startTime || contest.contest_date || contest.contestDate;
  if (!startTimeVal && contest.slug) {
    startTimeVal = getLeetCodeOfficialStartTime(contest.slug);
  }
  if (!startTimeVal) {
    startTimeVal = now;
  }
  const startTime = new Date(startTimeVal);

  // 2. Resolve End Time
  let endTime;
  if (contest.endTime) {
    endTime = new Date(contest.endTime);
  } else {
    const durationSeconds = contest.duration !== undefined ? contest.duration : 5400; // default 1.5 hours in seconds
    endTime = new Date(startTime.getTime() + durationSeconds * 1000);
  }

  // 3. Determine Lifecycle State
  if (now < startTime) {
    return {
      status: "UPCOMING",
      attendanceAvailable: false,
      hasLeaderboard: false,
      canSyncAttendance: false,
      canCalculateAnalytics: false,
      contestEnded: false
    };
  }

  if (now >= startTime && now < endTime) {
    return {
      status: "LIVE",
      attendanceAvailable: false,
      hasLeaderboard: false,
      canSyncAttendance: false,
      canCalculateAnalytics: false,
      contestEnded: false
    };
  }

  return {
    status: "FINISHED",
    attendanceAvailable: true,
    hasLeaderboard: true,
    canSyncAttendance: true,
    canCalculateAnalytics: true,
    contestEnded: true
  };
}

module.exports = {
  getContestStatus,
  getLeetCodeOfficialStartTime
};
