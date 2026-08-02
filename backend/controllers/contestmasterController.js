const db = require('../config/db');
const contestService = require('../services/contestmaster/ContestService');
const attendanceService = require('../services/contestmaster/AttendanceService');
const participantService = require('../services/contestmaster/ParticipantService');
const analyticsService = require('../services/contestmaster/AnalyticsService');
const syncService = require('../services/contestmaster/SyncService');

/**
 * ContestMasterController
 * Thin routing orchestrator. Validates requests, invokes dedicated services, and returns responses.
 */

async function getPlatformAnalytics(req, res) {
  const { platform } = req.params;
  const { studentId = 'all', batch, type, status, startDate, endDate, page, limit, search } = req.query;

  const validPlatforms = ['leetcode', 'codechef', 'codeforces'];
  if (!validPlatforms.includes(platform.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Invalid platform specified.' });
  }

  try {
    await syncService.checkAutoSync(platform);
    const analyticsData = await analyticsService.getPlatformAnalytics(platform, studentId, { batch, type, status, startDate, endDate });
    const contestListData = await contestService.getContests(platform, { type, status, page, limit, search });

    if (typeof res.set === 'function') {
      res.set('Cache-Control', 'no-store');
    }

    return res.json({
      success: true,
      contests: contestListData.contests,
      pagination: contestListData.pagination,
      metrics: analyticsData.metrics,
      monthlyTrendData: analyticsData.monthlyTrendData,
      semesterAnalyticsData: analyticsData.semesterAnalyticsData,
      batchComparisonData: analyticsData.batchComparisonData,
      studentSummaries: analyticsData.studentSummaries,
      platformRanking: analyticsData.platformRanking
    });
  } catch (error) {
    console.error(`[ContestMasterController] Error fetching ${platform} analytics:`, error);
    return res.status(500).json({ success: false, message: `Failed to retrieve ${platform} analytics dashboard data. Error: ${error.message}` });
  }
}

async function getContestMasterBatches(req, res) {
  try {
    const batches = await contestService.getAvailableBatches();
    return res.json(batches);
  } catch (error) {
    console.error('[ContestMasterController] Error fetching dynamic batches:', error);
    return res.status(500).json([]);
  }
}

async function getLiveCurrent(req, res) {
  try {
    const rows = await db.query(
      "SELECT * FROM LiveContests WHERE status IN ('Upcoming', 'Live', 'Synchronizing') ORDER BY startTime DESC LIMIT 1"
    );
    if (rows.length === 0) {
      return res.json({ success: true, contest: null, hasLiveContest: false, status: 'FINISHED' });
    }
    const contest = rows[0];
    const now = new Date();
    const status = now < new Date(contest.startTime) ? 'UPCOMING' : now > new Date(contest.endTime) ? 'FINISHED' : 'LIVE';
    return res.json({ success: true, contest, hasLiveContest: status !== 'FINISHED', status });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function getLiveStudents(req, res) {
  try {
    const { contestId, search, batch } = req.query;
    const data = await participantService.getContestParticipants(contestId, { batch, search });
    return res.json({ success: true, students: data.participants, contestId });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function getLiveAnalytics(req, res) {
  try {
    const data = await analyticsService.getPlatformAnalytics('leetcode');
    return res.json({ success: true, analytics: data.metrics });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function getLiveHealth(req, res) {
  try {
    const health = await syncService.getLiveHealth();
    return res.json({ success: true, health });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function triggerLiveControl(req, res) {
  return res.json({ success: true, message: 'Live control triggered.' });
}

async function getLiveStream(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('data: {"connected": true}\n\n');
}

module.exports = {
  getPlatformAnalytics,
  getContestMasterBatches,
  getLiveCurrent,
  getLiveStudents,
  getLiveAnalytics,
  getLiveHealth,
  triggerLiveControl,
  getLiveStream
};
