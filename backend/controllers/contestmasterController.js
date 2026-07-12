const db = require('../config/db');
const attendanceService = require('../services/attendanceService');
const {
  parseContestHistory,
  normalizeLeetCodeEntry,
  normalizeCodeChefEntry,
  normalizeCodeforcesEntry
} = require('../services/contestAnalyticsService');

const { formatBatchToLong, normalizeBatchToShort } = require('../utils/batchHelper');

// Live Tracker additions
const SyncLockManager = require('../services/syncLockManager');
const studentSyncQueue = require('../services/studentSyncQueue');
const snapshotEngine = require('../services/snapshotEngine');
const EventBus = require('../services/EventBus');
const MockProvider = require('../services/connectors/MockProvider');
const LeetCodeProvider = require('../services/connectors/LeetCodeProvider');
const FeatureFlags = require('../config/featureFlags');

// Helper to determine date only
function parseDateOnly(dateInput) {
  if (!dateInput) return new Date();
  const d = new Date(dateInput);
  return isNaN(d.getTime()) ? new Date() : d;
}

// Helper to determine contest timing
function getContestTiming(dateStr, durationSeconds = 5400) {
  const now = new Date();
  const startTime = new Date(dateStr);
  if (isNaN(startTime.getTime())) return 'past';
  const endTime = new Date(startTime.getTime() + durationSeconds * 1000);
  if (startTime > now) return 'upcoming';
  if (startTime <= now && endTime > now) return 'active';
  return 'past';
}

/**
 * Main analytics aggregator for a platform.
 */
async function getPlatformAnalytics(req, res) {
  const { platform } = req.params;
  const { studentId = 'all', batch, type, status, startDate, endDate } = req.query;

  const validPlatforms = ['leetcode', 'codechef', 'codeforces'];
  if (!validPlatforms.includes(platform.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Invalid platform specified.' });
  }

  // ── AUTOMATIC ON-DEMAND SYNC CHECK ──
  try {
    const dbPlatformMap = {
      leetcode: 'LeetCode',
      codechef: 'CodeChef',
      codeforces: 'Codeforces'
    };
    const dbPlatform = dbPlatformMap[platform.toLowerCase()];

    const unsyncedContests = await db.query(
      `SELECT contest_id, title 
       FROM Contests 
       WHERE platform = ? AND contest_status != 'Cancelled'
         AND slug NOT LIKE 'upcoming-live-%'
         AND slug NOT LIKE 'starting-%'
         AND slug NOT LIKE 'temporary-%'
         AND slug NOT LIKE 'placeholder-%'
         AND (
           last_synced_at IS NULL
           OR (start_time <= NOW() AND DATE_ADD(start_time, INTERVAL duration SECOND) > NOW() AND last_synced_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE))
           OR (DATE_ADD(start_time, INTERVAL duration SECOND) <= NOW() AND last_synced_at < DATE_ADD(start_time, INTERVAL duration SECOND))
         )`,
      [dbPlatform]
    );

    if (unsyncedContests.length > 0) {
      console.log(`[Auto-Sync] Found ${unsyncedContests.length} unsynced past/ongoing contests for ${platform}. Triggering sync...`);
      const { syncAllData } = require('../utils/scheduler');
      await syncAllData();
      console.log('[Auto-Sync] Synchronization complete.');
    }
  } catch (syncErr) {
    console.error('[Auto-Sync Error] Automatic check failed:', syncErr.message);
  }

  try {
    const data = await attendanceService.getPlatformAnalytics(platform, studentId, { batch, type, status, startDate, endDate });
    if (typeof res.set === 'function') {
      res.set('Cache-Control', 'no-store'); // prevent browser from caching dashboard data
    }
    return res.json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error(`[ContestMasterController] Error fetching ${platform} analytics:`, error);
    return res.status(500).json({ success: false, message: `Failed to retrieve ${platform} analytics dashboard data. Error: ${error.message}` });
  }
}

/**
 * Returns available batches dynamically from the database.
 * Only include batches that have at least one active student.
 * Sorted in ascending order.
 */
async function getContestMasterBatches(req, res) {
  try {
    const list = await db.query(
      `SELECT DISTINCT u.academic_batch 
       FROM Users u
       WHERE u.status = 'active' 
         AND u.academic_batch IS NOT NULL 
         AND u.academic_batch != ''
       ORDER BY u.academic_batch ASC`
    );
    const batches = list.map(item => formatBatchToLong(item.academic_batch));
    return res.json(batches);
  } catch (error) {
    console.error('[ContestMasterController] Error fetching dynamic batches:', error);
    return res.status(500).json([]);
  }
}

async function checkAndUpdateContestLifecycle() {
  // Query for the latest contest that isn't 'Completed'
  const rows = await db.query(
    "SELECT * FROM LiveContests WHERE status IN ('Upcoming', 'Live', 'Synchronizing') ORDER BY startTime DESC LIMIT 1"
  );
  if (rows.length === 0) {
    return { contest: null, status: 'FINISHED', hasLiveContest: false };
  }

  const contest = rows[0];
  const now = new Date();
  const startTime = new Date(contest.startTime);
  const endTime = new Date(contest.endTime);

  if (now > endTime) {
    // Contest has ended
    if (contest.status !== 'Completed') {
      await db.query(
        "UPDATE LiveContests SET status = 'Completed', lastSyncAt = NOW() WHERE id = ?",
        [contest.id]
      );
      // Stop sync jobs
      if (studentSyncQueue.activeContestId === contest.id) {
        studentSyncQueue.pause();
      }
      // Emit completing event to stop SSE updates on frontend
      EventBus.emit('ContestCompleted', { contestId: contest.id, status: 'Completed' });
    }

    return { contest: null, status: 'FINISHED', hasLiveContest: false };
  }

  if (now < startTime) {
    return { contest, status: 'UPCOMING', hasLiveContest: true };
  }

  return { contest, status: 'LIVE', hasLiveContest: true };
}

async function getLiveCurrent(req, res) {
  try {
    const lifecycle = await checkAndUpdateContestLifecycle();
    return res.json({
      success: true,
      contest: lifecycle.contest,
      hasLiveContest: lifecycle.hasLiveContest,
      status: lifecycle.status
    });
  } catch (err) {
    console.error('[ContestMasterController] Error fetching current contest:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function getLiveStudents(req, res) {
  const { contestId, search, batch, department, section, status } = req.query;
  try {
    let activeContestId = contestId;
    if (!activeContestId) {
      const activeRows = await db.query(
        "SELECT id FROM LiveContests WHERE status IN ('Live', 'Synchronizing') ORDER BY startTime DESC LIMIT 1"
      );
      if (activeRows.length > 0) {
        activeContestId = activeRows[0].id;
      } else {
        const latestRows = await db.query("SELECT id FROM LiveContests ORDER BY startTime DESC LIMIT 1");
        if (latestRows.length > 0) {
          activeContestId = latestRows[0].id;
        } else {
          return res.json({ success: true, students: [], contestId: null });
        }
      }
    }

    let query = `
      SELECT 
        u.id as studentId, u.name, u.roll_no, u.department, u.section, u.academic_batch, u.leetcode_username,
        ca.attendanceStatus, ca.rank, ca.solved, ca.score, ca.penalty, ca.ratingBefore, ca.ratingAfter, ca.ratingChange, ca.lastUpdatedAt
      FROM Users u
      LEFT JOIN ContestAttendance ca ON u.id = ca.studentId AND ca.contestId = ?
      WHERE u.status = 'active'
    `;
    const params = [activeContestId];

    if (search) {
      query += ` AND (u.name LIKE ? OR u.roll_no LIKE ? OR u.leetcode_username LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (batch) {
      query += ` AND u.academic_batch = ?`;
      params.push(batch);
    }
    if (department) {
      query += ` AND u.department = ?`;
      params.push(department);
    }
    if (section) {
      query += ` AND u.section = ?`;
      params.push(section);
    }
    if (status) {
      if (status === 'Unknown') {
        query += ` AND (ca.attendanceStatus IS NULL OR ca.attendanceStatus = 'Unknown')`;
      } else {
        query += ` AND ca.attendanceStatus = ?`;
        params.push(status);
      }
    }

    query += ` ORDER BY ca.rank ASC, u.name ASC`;
    const students = await db.query(query, params);

    const mapped = students.map(s => {
      let displayStatus = s.attendanceStatus || 'Unknown';
      return {
        ...s,
        attendanceStatus: displayStatus
      };
    });

    return res.json({ success: true, students: mapped, contestId: activeContestId });
  } catch (err) {
    console.error('[ContestMasterController] Error fetching live students:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function getLiveAnalytics(req, res) {
  const { contestId } = req.query;
  try {
    let activeContestId = contestId;
    if (!activeContestId) {
      const activeRows = await db.query(
        "SELECT id FROM LiveContests WHERE status IN ('Live', 'Synchronizing') ORDER BY startTime DESC LIMIT 1"
      );
      if (activeRows.length > 0) {
        activeContestId = activeRows[0].id;
      } else {
        const latestRows = await db.query("SELECT id FROM LiveContests ORDER BY startTime DESC LIMIT 1");
        if (latestRows.length > 0) {
          activeContestId = latestRows[0].id;
        } else {
          return res.json({ success: true, analytics: {} });
        }
      }
    }

    const rows = await db.query(
      `SELECT 
        u.id, u.name, u.department, u.section, u.academic_batch,
        ca.attendanceStatus, ca.rank, ca.solved, ca.score
      FROM Users u
      LEFT JOIN ContestAttendance ca ON u.id = ca.studentId AND ca.contestId = ?
      WHERE u.status = 'active'`,
      [activeContestId]
    );

    const buildAnalytics = (groupByKey) => {
      const groups = {};
      for (const r of rows) {
        let key = r[groupByKey] || 'Unknown';
        if (groupByKey === 'academic_batch') {
          key = formatBatchToLong(key);
        }
        if (!groups[key]) {
          groups[key] = {
            name: key,
            registered: 0,
            participating: 0,
            totalRank: 0,
            rankCount: 0,
            totalSolved: 0,
            solvedCount: 0,
            topPerformer: null,
            topScore: -1
          };
        }
        const g = groups[key];
        g.registered++;
        
        const isPart = r.attendanceStatus === 'Participating' || r.attendanceStatus === 'Present';
        if (isPart) {
          g.participating++;
          if (r.rank !== null && r.rank !== undefined) {
            g.totalRank += r.rank;
            g.rankCount++;
          }
          if (r.solved !== null && r.solved !== undefined) {
            g.totalSolved += r.solved;
            g.solvedCount++;
          }
          const score = parseFloat(r.score || 0);
          if (score > g.topScore) {
            g.topScore = score;
            g.topPerformer = r.name;
          }
        }
      }

      return Object.values(groups).map(g => {
        const avgRank = g.rankCount > 0 ? (g.totalRank / g.rankCount).toFixed(1) : 'N/A';
        const avgSolved = g.solvedCount > 0 ? (g.totalSolved / g.solvedCount).toFixed(1) : 'N/A';
        const attendancePercentage = g.registered > 0 ? ((g.participating / g.registered) * 100).toFixed(2) : '0.00';
        return {
          name: g.name,
          registered: g.registered,
          participating: g.participating,
          attendancePercentage: parseFloat(attendancePercentage),
          averageRank: avgRank === 'N/A' ? null : parseFloat(avgRank),
          averageSolved: avgSolved === 'N/A' ? null : parseFloat(avgSolved),
          topPerformer: g.topPerformer || 'N/A'
        };
      });
    };

    const batchAnalytics = buildAnalytics('academic_batch');
    const departmentAnalytics = buildAnalytics('department');
    const sectionAnalytics = buildAnalytics('section');

    const snapshotHistory = await db.query(
      `SELECT snapshotTime, participants, attendancePercentage, averageSolved, highestRank, averageRank
       FROM ContestSnapshots
       WHERE contestId = ?
       ORDER BY snapshotTime ASC`,
      [activeContestId]
    );

    return res.json({
      success: true,
      contestId: activeContestId,
      batch: batchAnalytics,
      department: departmentAnalytics,
      section: sectionAnalytics,
      history: snapshotHistory
    });
  } catch (err) {
    console.error('[ContestMasterController] Error generating live analytics:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function getLiveHealth(req, res) {
  try {
    const queueProgress = studentSyncQueue.getProgress();
    const lockStatus = SyncLockManager.getStatus();
    const clientsCount = EventBus.listenerCount('StudentUpdated');

    const providerHealth = {
      platform: 'LeetCode',
      providerStatus: 'Healthy',
      currentDatasource: 'MockGraphQL',
      datasourcePriority: ['MockGraphQL', 'MockLeaderboard', 'CachedFile'],
      capabilityAvailability: {
        contestDetection: true,
        liveParticipation: true,
        contestHistory: true,
        ratingHistory: true,
        leaderboard: true,
        submissions: false
      },
      healthScore: 100,
      failoverCount: 0,
      cacheHitRatio: 0.95,
      averageResponseTime: 85,
      syncLockState: lockStatus.state,
      activeContestId: lockStatus.activeContestId,
      queue: queueProgress,
      activeSseClients: clientsCount
    };

    return res.json({ success: true, health: providerHealth });
  } catch (err) {
    console.error('[ContestMasterController] Error fetching health metrics:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function triggerLiveControl(req, res) {
  const { action, contestId } = req.body;
  if (!action) {
    return res.status(400).json({ success: false, message: 'Action parameter is required.' });
  }

  try {
    let targetContestId = contestId;
    if (!targetContestId) {
      const activeRows = await db.query(
        "SELECT id FROM LiveContests WHERE status IN ('Live', 'Synchronizing') ORDER BY startTime DESC LIMIT 1"
      );
      if (activeRows.length > 0) {
        targetContestId = activeRows[0].id;
      } else {
        const latestRows = await db.query("SELECT id FROM LiveContests ORDER BY startTime DESC LIMIT 1");
        if (latestRows.length > 0) {
          targetContestId = latestRows[0].id;
        } else {
          return res.status(404).json({ success: false, message: 'No active or registered contests found.' });
        }
      }
    }

    if (action === 'sync') {
      if (studentSyncQueue.activeContestId) {
        return res.status(400).json({ success: false, message: 'A synchronization is already running.' });
      }

      // Fetch target contest details
      const contestRows = await db.query("SELECT platform, contestSlug, endTime FROM LiveContests WHERE id = ?", [targetContestId]);
      if (contestRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Target contest not found.' });
      }
      const { platform, contestSlug, endTime } = contestRows[0];

      if (new Date() > new Date(endTime)) {
        return res.status(400).json({ success: false, message: 'Cannot start manual synchronization for an ended contest.' });
      }

      // Resolve provider
      const providerInstance = platform === 'LeetCode' && (FeatureFlags.isEnabled('scraper') || FeatureFlags.isEnabled('graphql'))
        ? new LeetCodeProvider()
        : new MockProvider();

      const students = await db.query("SELECT id, name, leetcode_username FROM Users WHERE status = 'active'");
      
      const syncFunc = async (student, provider) => {
        if (!student.leetcode_username || !student.leetcode_username.trim()) {
          await snapshotEngine.compareAndUpdate(targetContestId, student.id, student.leetcode_username || '', {
            attendanceStatus: 'Absent',
            rank: null,
            solved: 0,
            score: 0.00,
            penalty: 0,
            ratingBefore: null
          });
          return;
        }

        const stats = await provider.getStudentContestStatus(student.leetcode_username, contestSlug);
        let mappedStatus = 'Unknown';
        if (stats.participating) {
          mappedStatus = 'Participating';
        }
        
        await snapshotEngine.compareAndUpdate(targetContestId, student.id, student.leetcode_username, {
          attendanceStatus: mappedStatus,
          rank: stats.rank || null,
          solved: stats.solved || 0,
          score: stats.score || 0.00,
          penalty: stats.penalty || 0,
          ratingBefore: stats.ratingBefore || null
        });
      };

      await snapshotEngine.loadSnapshot(targetContestId);

      studentSyncQueue.start(targetContestId, students, providerInstance, syncFunc).catch(err => {
        console.error('[Sync Trigger] Queue crashed asynchronously:', err.message);
      });

      return res.json({ success: true, message: 'Sync queue started successfully.' });
    }

    if (action === 'pause') {
      studentSyncQueue.pause();
      return res.json({ success: true, message: 'Sync queue paused successfully.' });
    }

    if (action === 'resume') {
      // Fetch target contest details
      const contestRows = await db.query("SELECT platform, contestSlug FROM LiveContests WHERE id = ?", [targetContestId]);
      if (contestRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Target contest not found.' });
      }
      const { platform, contestSlug } = contestRows[0];

      // Resolve provider
      const providerInstance = platform === 'LeetCode' && (FeatureFlags.isEnabled('scraper') || FeatureFlags.isEnabled('graphql'))
        ? new LeetCodeProvider()
        : new MockProvider();

      const syncFunc = async (student, provider) => {
        if (!student.leetcode_username || !student.leetcode_username.trim()) {
          await snapshotEngine.compareAndUpdate(targetContestId, student.id, student.leetcode_username || '', {
            attendanceStatus: 'Absent',
            rank: null,
            solved: 0,
            score: 0.00,
            penalty: 0,
            ratingBefore: null
          });
          return;
        }

        const stats = await provider.getStudentContestStatus(student.leetcode_username, contestSlug);
        let mappedStatus = 'Unknown';
        if (stats.participating) {
          mappedStatus = 'Participating';
        }
        await snapshotEngine.compareAndUpdate(targetContestId, student.id, student.leetcode_username, {
          attendanceStatus: mappedStatus,
          rank: stats.rank || null,
          solved: stats.solved || 0,
          score: stats.score || 0.00,
          penalty: stats.penalty || 0,
          ratingBefore: stats.ratingBefore || null
        });
      };
      
      studentSyncQueue.resume(providerInstance, syncFunc);
      return res.json({ success: true, message: 'Sync queue resumed successfully.' });
    }

    if (action === 'finalize') {
      await db.query("UPDATE LiveContests SET status = 'Completed', lastSyncAt = NOW() WHERE id = ?", [targetContestId]);
      
      const students = await db.query("SELECT id, leetcode_username FROM Users WHERE status = 'active'");
      await snapshotEngine.loadSnapshot(targetContestId);
      
      for (const s of students) {
        const prev = snapshotEngine.previousSnapshots[targetContestId] || {};
        const old = prev[s.id];
        
        let finalStatus = 'Absent';
        let solved = 0;
        let score = 0;
        let rank = null;
        let penalty = 0;
        let ratingBefore = null;

        if (old && (old.attendanceStatus === 'Participating' || old.attendanceStatus === 'Present')) {
          finalStatus = 'Present';
          solved = old.solved;
          score = old.score;
          rank = old.rank;
          penalty = old.penalty;
          ratingBefore = old.ratingBefore;
        }

        await snapshotEngine.compareAndUpdate(targetContestId, s.id, s.leetcode_username, {
          attendanceStatus: finalStatus,
          rank,
          solved,
          score,
          penalty,
          ratingBefore
        });
      }

      await snapshotEngine.recordContestSnapshot(targetContestId);
      EventBus.emit('ContestCompleted', { contestId: targetContestId, status: 'Completed' });

      return res.json({ success: true, message: 'Contest finalized successfully.' });
    }

    if (action === 'recalculate') {
      await snapshotEngine.recordContestSnapshot(targetContestId);
      return res.json({ success: true, message: 'Recalculated stats and updated snapshots.' });
    }

    return res.status(400).json({ success: false, message: 'Unknown control action.' });
  } catch (err) {
    console.error('[ContestMasterController] Error during control trigger:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function getLiveStream(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write('data: {"connected": true}\n\n');

  const onStudentUpdated = (payload) => {
    res.write(`event: StudentUpdated\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const onContestCompleted = (payload) => {
    res.write(`event: ContestCompleted\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const onSnapshotCreated = (payload) => {
    res.write(`event: SnapshotCreated\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const onSyncProgress = (payload) => {
    res.write(`event: SyncProgress\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  EventBus.on('StudentUpdated', onStudentUpdated);
  EventBus.on('ContestCompleted', onContestCompleted);
  EventBus.on('SnapshotCreated', onSnapshotCreated);
  EventBus.on('SyncProgress', onSyncProgress);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    EventBus.off('StudentUpdated', onStudentUpdated);
    EventBus.off('ContestCompleted', onContestCompleted);
    EventBus.off('SnapshotCreated', onSnapshotCreated);
    EventBus.off('SyncProgress', onSyncProgress);
    console.log('[SSE] Client disconnected, listeners cleared.');
  });
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
