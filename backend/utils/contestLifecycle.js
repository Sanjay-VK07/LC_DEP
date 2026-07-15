/**
 * Central utility to determine contest lifecycle state.
 * This is the Centralized Source of Truth for contest state across the application.
 */

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
  getContestStatus
};
