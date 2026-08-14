const db = require('../config/db');
const jobQueue = require('../services/jobQueueService');
const cache = require('../services/analyticsCacheService');
const auditLog = require('../services/auditLogService');
const { classifyCodeforcesType } = require('../services/attendanceService');

// Helper to determine contest status dynamically
function getContestStatus(slug) {
  if (!slug) return 'RATED';
  const cleanSlug = slug.toLowerCase();
  if (cleanSlug.includes('biweekly-contest-126') || cleanSlug.includes('biweekly-contest-127')) {
    return 'UNRATED';
  }
  return 'RATED';
}

// Helper to parse contest type and number from slug
function parseContestSlug(slug) {
  if (!slug) return { contest_type: null, contest_number: 0 };
  const cleanSlug = slug.toLowerCase();
  let contest_type = null;
  let contest_number = 0;

  if (cleanSlug.includes('biweekly')) {
    contest_type = 'Biweekly';
  } else if (cleanSlug.includes('weekly')) {
    contest_type = 'Weekly';
  }

  const match = cleanSlug.match(/contest-(\d+)/);
  if (match) {
    contest_number = parseInt(match[1], 10);
  }

  return { contest_type, contest_number };
}

// 1. Get all unique contests with attendance counts and registration status
async function getContests(req, res) {
  const { type, startDate, endDate, userId } = req.query;
  try {
    let query = `
      SELECT 
        c.contest_id,
        c.slug AS contest_slug, 
        c.title AS name, 
        c.start_time AS date, 
        c.contest_status,
        c.contest_type,
        c.platform,
        (SELECT COUNT(DISTINCT r.user_id) FROM Registrations r WHERE r.contest_id = c.contest_id) AS registration_count,
        (SELECT COUNT(DISTINCT ar.user_id) FROM AttendanceRecords ar WHERE ar.contest_id = c.contest_id AND UPPER(ar.attendance_status) = 'PRESENT') AS attendance_count
    `;
    const params = [];
    if (userId) {
      query += `,
        (SELECT COUNT(DISTINCT r.user_id) FROM Registrations r WHERE r.contest_id = c.contest_id AND r.user_id = ?) AS is_registered,
        (SELECT COUNT(DISTINCT p.user_id) FROM ParticipationLogs p WHERE p.contest_id = c.contest_id AND p.user_id = ?) AS is_joined
      `;
      params.push(userId, userId);
    }
    
    query += ` FROM Contests c`;
    const conditions = [
      `c.slug NOT LIKE 'upcoming-live-%'`,
      `c.slug NOT LIKE 'starting-%'`,
      `c.slug NOT LIKE 'temporary-%'`,
      `c.slug NOT LIKE 'placeholder-%'`
    ];

    if (!req.query.includeFuture) {
      conditions.push(`c.start_time <= NOW()`);
    }

    if (type) {
      conditions.push(`c.contest_type = ?`);
      params.push(type.toLowerCase() === 'biweekly' ? 'Biweekly' : 'Weekly');
    }
    if (startDate) {
      conditions.push(`c.start_time >= ?`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`c.start_time <= ?`);
      params.push(endDate);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    query += ` ORDER BY c.start_time DESC`;

    const contests = await db.query(query, params);
    const { getLeetCodeOfficialStartTime } = require('../utils/contestLifecycle');

    // Enrich with type and status
    const enriched = contests.map((c) => {
      let contestType = c.contest_type ? c.contest_type.toLowerCase() : 'weekly';
      const platformLower = c.platform ? c.platform.toLowerCase() : '';
      if (platformLower === 'codeforces') {
        contestType = classifyCodeforcesType(c.name);
      } else if (platformLower === 'codechef') {
        contestType = 'starters';
        const nameLower = c.name.toLowerCase();
        if (nameLower.includes('cook-off') || nameLower.includes('cook')) contestType = 'cook-off';
        else if (nameLower.includes('lunchtime')) contestType = 'lunchtime';
        else if (nameLower.includes('long challenge') || nameLower.includes('long')) contestType = 'long challenge';
      } else {
        if (c.name.toLowerCase().includes('biweekly')) {
          contestType = 'biweekly';
        }
      }
      const status = c.contest_status ? c.contest_status.toUpperCase() : 'RATED';
      const officialDate = getLeetCodeOfficialStartTime(c.contest_slug) || c.date;

      const { calculateContestSnapshotMetrics } = require('../utils/contestMetrics');
      const snapshotMetrics = calculateContestSnapshotMetrics({
        registered: c.registration_count,
        attended: c.attendance_count,
        contestId: c.contest_id,
        contestSlug: c.contest_slug
      });

      return {
        id: c.contest_id,
        contest_id: c.contest_slug,
        name: c.name,
        date: officialDate instanceof Date ? officialDate.toISOString() : officialDate,
        type: contestType,
        status: status,
        registration_count: snapshotMetrics.registration_count,
        attendance_count: snapshotMetrics.attendance_count,
        attendance_rate: snapshotMetrics.attendance_rate,
        displayRate: snapshotMetrics.displayRate,
        is_registered: userId ? c.is_registered > 0 : false,
        is_joined: userId ? c.is_joined > 0 : false
      };
    });

    return res.json({ success: true, count: enriched.length, data: enriched });
  } catch (error) {
    console.error('Error fetching contests:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve contests' });
  }
}

// 2. Add contest
async function addContest(req, res) {
  const { contestId, name, date, type, platform } = req.body;
  if (!contestId || !name || !date) {
    return res.status(400).json({ success: false, message: 'Contest ID (slug), Name, and Date are required.' });
  }

  const isTestOrDevEnv = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'dev';
  if (!isTestOrDevEnv) {
    const testPatterns = [
      /\btest\b/i,
      /\bfail\b/i,
      /\bdummy\b/i,
      /\bmock\b/i,
      /\bsample\b/i,
      /\bdemo\b/i,
      /\bdebug\b/i,
      /\bfake\b/i,
      /\bseed\b/i,
      /\btemporary\b/i
    ];
    if (testPatterns.some(pat => pat.test(name) || pat.test(contestId))) {
      return res.status(400).json({
        success: false,
        message: 'Production Safety Rule: Contest name or ID contains testing/mock keywords. Insert rejected.'
      });
    }
  }

  try {
    const slug = contestId.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const contestType = type.toLowerCase() === 'biweekly' ? 'Biweekly' : 'Weekly';
    
    // Parse contest number from slug
    const match = slug.match(/contest-(\d+)/);
    const contestNumber = match ? parseInt(match[1], 10) : 0;
    const dbContestStatus = getContestStatus(slug) === 'UNRATED' ? 'Unrated' : 'Rated';

    // Auto-detect platform if not provided
    let dbPlatform = platform || 'LeetCode';
    if (!platform) {
      const cleanId = contestId.toLowerCase();
      if (cleanId.includes('codechef') || cleanId.includes('starters') || cleanId.includes('lunchtime') || cleanId.includes('cook-off')) {
        dbPlatform = 'CodeChef';
      } else if (cleanId.includes('codeforces') || cleanId.includes('educational') || cleanId.includes('global')) {
        dbPlatform = 'Codeforces';
      }
    }

    await db.query(
      `INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, contest_status, platform)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, slug, contestType, contestNumber, date, dbContestStatus, dbPlatform]
    );

    return res.json({ success: true, message: 'Contest added successfully.' });
  } catch (error) {
    console.error('Error adding contest:', error);
    return res.status(500).json({ success: false, message: 'Failed to add contest. Check if the ID/Slug is unique.' });
  }
}

// 3. Edit contest
async function editContest(req, res) {
  const { id } = req.params;
  const { contestId, name, date, type, platform } = req.body;
  if (!contestId || !name || !date) {
    return res.status(400).json({ success: false, message: 'Contest ID (slug), Name, and Date are required.' });
  }

  const isTestOrDevEnv = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'dev';
  if (!isTestOrDevEnv) {
    const testPatterns = [
      /\btest\b/i,
      /\bfail\b/i,
      /\bdummy\b/i,
      /\bmock\b/i,
      /\bsample\b/i,
      /\bdemo\b/i,
      /\bdebug\b/i,
      /\bfake\b/i,
      /\bseed\b/i,
      /\btemporary\b/i
    ];
    if (testPatterns.some(pat => pat.test(name) || pat.test(contestId))) {
      return res.status(400).json({
        success: false,
        message: 'Production Safety Rule: Contest name or ID contains testing/mock keywords. Rename rejected.'
      });
    }
  }

  try {
    const slug = contestId.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const contestType = type.toLowerCase() === 'biweekly' ? 'Biweekly' : 'Weekly';
    
    const match = slug.match(/contest-(\d+)/);
    const contestNumber = match ? parseInt(match[1], 10) : 0;
    const dbContestStatus = getContestStatus(slug) === 'UNRATED' ? 'Unrated' : 'Rated';

    // Verify contest exists
    const contest = await db.query('SELECT contest_id FROM Contests WHERE contest_id = ? OR slug = ?', [id, id]);
    if (contest.length === 0) {
      return res.status(404).json({ success: false, message: 'Contest not found.' });
    }
    const realId = contest[0].contest_id;

    // Auto-detect platform if not provided
    let dbPlatform = platform || 'LeetCode';
    if (!platform) {
      const cleanId = contestId.toLowerCase();
      if (cleanId.includes('codechef') || cleanId.includes('starters') || cleanId.includes('lunchtime') || cleanId.includes('cook-off')) {
        dbPlatform = 'CodeChef';
      } else if (cleanId.includes('codeforces') || cleanId.includes('educational') || cleanId.includes('global')) {
        dbPlatform = 'Codeforces';
      }
    }

    await db.query(
      `UPDATE Contests 
       SET title = ?, slug = ?, contest_type = ?, contest_number = ?, start_time = ?, contest_status = ?, platform = ?
       WHERE contest_id = ?`,
      [name, slug, contestType, contestNumber, date, dbContestStatus, dbPlatform, realId]
    );

    return res.json({ success: true, message: 'Contest updated successfully.' });
  } catch (error) {
    console.error('Error editing contest:', error);
    return res.status(500).json({ success: false, message: 'Failed to update contest.' });
  }
}

// 4. Delete contest
async function deleteContest(req, res) {
  const { id } = req.params;
  try {
    const contest = await db.query('SELECT contest_id FROM Contests WHERE contest_id = ? OR slug = ?', [id, id]);
    if (contest.length === 0) {
      return res.status(404).json({ success: false, message: 'Contest not found.' });
    }
    const realId = contest[0].contest_id;

    await db.query('DELETE FROM Contests WHERE contest_id = ?', [realId]);

    return res.json({ success: true, message: 'Contest deleted successfully.' });
  } catch (error) {
    console.error('Error deleting contest:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete contest.' });
  }
}

// 5. Trigger manual sync — enqueues a background job, returns immediately
async function triggerSync(req, res) {
  try {
    const { syncAllData } = require('../utils/scheduler');
    const jobId = jobQueue.enqueue(
      jobQueue.JOB_TYPE.PLATFORM_SYNC,
      { triggeredBy: 'manual', timestamp: new Date().toISOString() },
      async (job, updateProgress) => {
        updateProgress(5, 'Starting platform synchronization...');
        const result = await syncAllData();
        updateProgress(95, 'Invalidating analytics cache...');
        cache.invalidateAll();
        updateProgress(100, 'Sync completed');
        return result;
      }
    );
    await auditLog.log(auditLog.AUDIT_ACTIONS.SYNC_STARTED, {
      details: { jobId, trigger: 'manual' }
    });
    return res.json({ success: true, message: 'Sync job started in background', jobId });
  } catch (error) {
    console.error('Manual sync error:', error);
    return res.status(500).json({ success: false, message: 'Failed to start sync: ' + error.message });
  }
}

// 6. Get sync logs
async function getSyncLogs(req, res) {
  try {
    const logs = await db.query('SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 50');
    return res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Error fetching sync logs:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve synchronization logs' });
  }
}

// 7. Register for contest
async function registerContest(req, res) {
  const { userId, contestId } = req.body;
  if (!userId || !contestId) {
    return res.status(400).json({ success: false, message: 'User ID and Contest ID are required.' });
  }
  try {
    await db.query(
      "INSERT IGNORE INTO Registrations (user_id, contest_id) VALUES (?, ?)",
      [userId, contestId]
    );

    // Seed default ABSENT attendance record
    await db.query(
      `INSERT IGNORE INTO AttendanceRecords (user_id, contest_id, attendance_status, attendance_source)
       VALUES (?, ?, 'ABSENT', 'AUTO')`,
      [userId, contestId]
    );

    return res.json({ success: true, message: 'Registered for contest successfully.' });
  } catch (error) {
    console.error('Error registering for contest:', error);
    return res.status(500).json({ success: false, message: 'Failed to register for contest.' });
  }
}

// 8. Join contest
async function joinContest(req, res) {
  const { userId, contestId } = req.body;
  if (!userId || !contestId) {
    return res.status(400).json({ success: false, message: 'User ID and Contest ID are required.' });
  }
  try {
    // Ensure registered first
    await db.query(
      "INSERT IGNORE INTO Registrations (user_id, contest_id) VALUES (?, ?)",
      [userId, contestId]
    );

    // Insert to ParticipationLogs
    await db.query(
      `INSERT INTO ParticipationLogs (user_id, contest_id, join_time, participation_status)
       VALUES (?, ?, CURRENT_TIMESTAMP, 'JOINED')
       ON DUPLICATE KEY UPDATE join_time = CURRENT_TIMESTAMP, participation_status = 'JOINED'`,
      [userId, contestId]
    );

    // Mark PRESENT in AttendanceRecords
    await db.query(
      `INSERT INTO AttendanceRecords (user_id, contest_id, attendance_status, attendance_source)
       VALUES (?, ?, 'PRESENT', 'AUTO')
       ON DUPLICATE KEY UPDATE attendance_status = 'PRESENT', attendance_source = 'AUTO'`,
      [userId, contestId]
    );

    return res.json({ success: true, message: 'Joined contest successfully. Attendance marked as PRESENT.' });
  } catch (error) {
    console.error('Error joining contest:', error);
    return res.status(500).json({ success: false, message: 'Failed to join contest.' });
  }
}

module.exports = {
  getContests,
  addContest,
  editContest,
  deleteContest,
  triggerSync,
  getSyncLogs,
  registerContest,
  joinContest
};
