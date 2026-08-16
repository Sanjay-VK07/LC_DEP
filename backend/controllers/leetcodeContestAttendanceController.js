const db = require('../config/db');
const LeetCodeRankingSearchService = require('../services/leetcodeRankingSearchService');
const { normalizeAttendanceStatus } = require('../utils/attendanceNormalizer');
const CloudflareBlockedError = require('../utils/CloudflareBlockedError');

/**
 * Controller to handle LeetCode Contest Ranking Search Attendance actions
 */
const LeetCodeContestAttendanceController = {
  /**
   * Post endpoint to trigger contest synchronization
   */
  async syncContest(req, res) {
    const { performance } = require('perf_hooks');
    const reqStart = performance.now();
    const requestId = req.requestId || `sync_${Date.now()}`;

    const authMs = Math.round(performance.now() - reqStart);
    console.log(`[LeetCode Sync Telemetry] Request Started -> Authentication (${authMs} ms)`);

    const { contestSlug, providerType } = req.body;
    if (!contestSlug || typeof contestSlug !== 'string' || !contestSlug.trim()) {
      return res.status(400).json({ success: false, message: 'LeetCode contest slug is required.' });
    }

    const slug = contestSlug.trim().toLowerCase();

    try {
      const jobQueue = require('../services/jobQueueService');
      const StudentContestSyncService = require('../services/StudentContestSyncService');

      console.log(`[LeetCode Sync Telemetry] Enqueuing background sync job for "${slug}" using provider "${providerType || process.env.SYNC_PROVIDER || 'HYBRID'}"...`);

      const jobId = jobQueue.enqueue(
        jobQueue.JOB_TYPE.CONTEST_ATTENDANCE_SYNC,
        { contestSlug: slug, providerType, actor: req.user?.username || 'ADMIN_API' },
        async (job, updateProgress) => {
          updateProgress(5, `Fetching active student roster for '${slug}'...`);
          const result = await StudentContestSyncService.syncContestAttendance({
            contestSlug: slug,
            providerType: providerType || process.env.SYNC_PROVIDER || 'HYBRID',
            actor: req.user?.username || 'ADMIN_API',
            bypassCache: true,
            onProgress: (pct, msg) => updateProgress(pct, msg)
          });
          updateProgress(95, 'Saving attendance records to database...');
          return result;
        }
      );

      const totalMs = Math.round(performance.now() - reqStart);
      console.log(`[LeetCode Sync Telemetry] Request Started -> Authentication (${authMs} ms) -> Job Enqueued (${totalMs} ms) -> Response Sent (${totalMs} ms) [jobId="${jobId}", reqId="${requestId}"]`);

      return res.json({
        success: true,
        message: `Successfully enqueued attendance synchronization job for contest '${slug}'!`,
        jobId,
        data: {
          jobId,
          status: 'RUNNING',
          contestSlug: slug,
          provider: providerType || process.env.SYNC_PROVIDER || 'HYBRID'
        },
        telemetry: {
          authMs,
          totalMs
        }
      });
    } catch (error) {
      console.error(`[Contest Sync Controller Error]:`, error);
      
      let stage = 'Unknown';
      const errorMsg = error.message || 'Unknown error occurred.';
      
      if (error.name === 'CloudflareBlockedError' || error.isCloudflare || error.code === 'CLOUDFLARE_BLOCK') {
        const userMsg = error.userMessage || CloudflareBlockedError.DEFAULT_USER_MESSAGE;
        const upstreamStatus = error.status || 403;
        return res.status(upstreamStatus).json({
          success: false,
          code: error.code || 'CLOUDFLARE_BLOCK',
          stage: 'Cloudflare Security',
          message: userMsg,
          userMessage: userMsg,
          contestSlug: slug,
          pageNumber: error.pageNumber !== undefined ? error.pageNumber : 1,
          upstreamStatus,
          error: error.message
        });
      }

      if (errorMsg.includes('database') || errorMsg.includes('SQL') || errorMsg.includes('ER_') || errorMsg.includes('query')) {
        stage = 'Database';
      } else if (errorMsg.includes('parse') || errorMsg.includes('JSON') || errorMsg.includes('Unexpected token')) {
        stage = 'Ranking Parser';
      } else if (errorMsg.includes('ranking is inaccessible') || errorMsg.includes('Network') || errorMsg.includes('curl') || errorMsg.includes('HTTP')) {
        stage = 'LeetCode API';
      } else if (errorMsg.includes('already running')) {
        stage = 'Concurrency Lock';
      }
      
      return res.status(500).json({
        success: false,
        stage: stage,
        error: errorMsg,
        stack: error.stack,
        contestSlug: slug,
        message: `[${stage} Error] ${errorMsg}`
      });
    }
  },

  /**
   * Get endpoint to retrieve contest attendance list and dashboard statistics
   */
  async getStatsAndRecords(req, res) {
    const { contestSlug, department, batch, section } = req.query;

    if (!contestSlug || typeof contestSlug !== 'string' || !contestSlug.trim()) {
      return res.status(400).json({ success: false, message: 'contestSlug parameter is required.' });
    }

    const slug = contestSlug.trim().toLowerCase();

    try {
      // 1. Get LiveContests info
      const contestRows = await db.query(
        "SELECT id, contestName, contestSlug, totalParticipants, lastSyncAt, currentSyncPass, status, endTime FROM LiveContests WHERE contestSlug = ?",
        [slug]
      );
      const contest = contestRows.length > 0 ? contestRows[0] : null;

      // 2. Get total active students matching filters
      let studentQuery = "SELECT COUNT(*) as total FROM Users WHERE status = 'active'";
      const studentParams = [];
      if (department) {
        studentQuery += " AND department = ?";
        studentParams.push(department);
      }
      if (batch) {
        studentQuery += " AND academic_batch = ?";
        studentParams.push(batch);
      }
      if (section) {
        studentQuery += " AND section = ?";
        studentParams.push(section);
      }

      const totalResult = await db.query(studentQuery, studentParams);
      const totalRegistered = totalResult[0]?.total || 0;

      // 3. Fetch count of Present, Absent, Pending
      let statsQuery = `
        SELECT 
          COALESCE(SUM(CASE WHEN ca.attendanceStatus = 'Present' OR ca.attendanceStatus = 'Participating' THEN 1 ELSE 0 END), 0) as present,
          COALESCE(SUM(CASE WHEN ca.attendanceStatus = 'Absent' THEN 1 ELSE 0 END), 0) as absent,
          COALESCE(SUM(CASE WHEN ca.attendanceStatus = 'Pending' OR ca.attendanceStatus = 'Unknown' THEN 1 ELSE 0 END), 0) as pending
        FROM ContestAttendance ca
        JOIN Users u ON ca.studentId = u.id
        WHERE ca.contestId = ? AND u.status = 'active'
      `;
      const statsParams = [contest ? contest.id : 0];
      if (department) {
        statsQuery += " AND u.department = ?";
        statsParams.push(department);
      }
      if (batch) {
        statsQuery += " AND u.academic_batch = ?";
        statsParams.push(batch);
      }
      if (section) {
        statsQuery += " AND u.section = ?";
        statsParams.push(section);
      }

      let presentCount = 0;
      let absentCount = totalRegistered;
      let pendingCount = 0;

      if (contest) {
        const statsResult = await db.query(statsQuery, statsParams);
        presentCount = parseInt(statsResult[0]?.present || 0, 10);
        absentCount = parseInt(statsResult[0]?.absent || 0, 10);
        pendingCount = parseInt(statsResult[0]?.pending || 0, 10);
      }

      const attendancePercentage = totalRegistered > 0 
        ? Math.round((presentCount / totalRegistered) * 100) 
        : 0;

      // 4. Retrieve complete individual records matching filters
      let records = [];
      if (contest) {
        let recordsQuery = `
          SELECT 
            ca.id,
            ca.contestId,
            ca.username as leetcode_username,
            ca.attendanceStatus as attendance,
            ca.rank,
            ca.score,
            ca.penalty as finish_time,
            ca.lastUpdatedAt as synced_at,
            ca.verified,
            ca.syncPass,
            u.name as student_name,
            u.roll_no,
            u.department,
            u.section,
            u.academic_batch
          FROM ContestAttendance ca
          JOIN Users u ON ca.studentId = u.id
          WHERE ca.contestId = ? AND u.status = 'active'
        `;
        const recordsParams = [contest.id];
        if (department) {
          recordsQuery += " AND u.department = ?";
          recordsParams.push(department);
        }
        if (batch) {
          recordsQuery += " AND u.academic_batch = ?";
          recordsParams.push(batch);
        }
        if (section) {
          recordsQuery += " AND u.section = ?";
          recordsParams.push(section);
        }
        recordsQuery += " ORDER BY ca.attendanceStatus DESC, ca.rank ASC, u.name ASC";
        records = await db.query(recordsQuery, recordsParams);
        records = records.map(r => ({
          ...r,
          attendance: normalizeAttendanceStatus(r.attendance)
        }));
      }

      // 5. Query persistent sync logs from ContestSyncLog
      let syncLog = null;
      if (contest) {
        const logRows = await db.query(
          "SELECT started_at, completed_at, total_requests, failed_requests, retry_count, participantsFetched FROM ContestSyncLog WHERE contestId = ? ORDER BY started_at DESC LIMIT 1",
          [contest.id]
        );
        if (logRows.length > 0) {
          syncLog = logRows[0];
        }
      }

      // Check ContestParticipants count in DB as telemetry fallback
      let cpCount = 0;
      try {
        const cpRows = await db.query("SELECT COUNT(*) as count FROM ContestParticipants WHERE contest_slug = ?", [slug]);
        cpCount = cpRows[0]?.count || 0;
      } catch (e) {}

      let effectiveDownloaded = (contest && contest.totalParticipants > 0)
        ? contest.totalParticipants
        : ((syncLog && syncLog.participantsFetched > 0)
          ? syncLog.participantsFetched
          : cpCount);

      // If effectiveDownloaded is 0 and CLIST provider is configured, retrieve live CLIST contest participant count
      if (effectiveDownloaded === 0) {
        try {
          const ClistAdapterClass = require('../services/clist/ClistAdapter');
          const clistAdapter = new ClistAdapterClass();
          if (clistAdapter.isAvailable()) {
            const ClistClient = require('../services/clist/ClistClient');
            const searchString = slug.replace(/-/g, ' ');
            const searchRes = await ClistClient.getContests({
              resource: 'leetcode.com',
              search: searchString
            }).catch(() => null);

            if (searchRes && searchRes.objects && searchRes.objects.length > 0) {
              const matched = searchRes.objects.find(c =>
                (c.key || '').toLowerCase() === slug.toLowerCase() ||
                (c.event || '').toLowerCase() === searchString.toLowerCase() ||
                (c.href || '').toLowerCase().includes(slug.toLowerCase())
              ) || searchRes.objects[0];

              if (matched && matched.id) {
                const sampleStats = await ClistClient.getContestParticipants(matched.id, {
                  resource: 'leetcode.com',
                  limit: 1
                }).catch(() => null);

                if (sampleStats && sampleStats.meta) {
                  effectiveDownloaded = sampleStats.meta.estimated_count || sampleStats.meta.total_count || (sampleStats.objects ? sampleStats.objects.length : 0);
                }
              }
            }
          }
        } catch (clistErr) {
          console.warn('[leetcodeContestAttendanceController] CLIST fallback telemetry check skipped:', clistErr.message);
        }
      }

      // Calculate next scheduled sync
      let nextSyncTime = 'None';
      if (contest && contest.status !== 'Completed') {
        const lastSync = contest.lastSyncAt ? new Date(contest.lastSyncAt) : new Date();
        const pass = contest.currentSyncPass || 0;
        if (contest.status === 'Live') {
          nextSyncTime = new Date(lastSync.getTime() + 5 * 60 * 1000).toISOString();
        } else if (contest.status === 'Synchronizing') {
          if (pass === 1) nextSyncTime = new Date(lastSync.getTime() + 10 * 60 * 1000).toISOString();
          else if (pass === 2) nextSyncTime = new Date(lastSync.getTime() + 30 * 60 * 1000).toISOString();
          else if (pass === 3) nextSyncTime = new Date(lastSync.getTime() + 120 * 60 * 1000).toISOString();
        }
      }

      // Cache size and provider metrics
      const LeetCodeProviderClass = require('../services/connectors/LeetCodeProvider');
      const provider = new LeetCodeProviderClass();
      const inMemoryIndex = provider.leaderboardIndices[slug];
      const cacheStatus = inMemoryIndex ? 'Cached (In Memory & Disk)' : (contest ? 'Disk Cached' : 'No Cache');
      const cacheSize = inMemoryIndex ? Object.keys(inMemoryIndex).length : effectiveDownloaded;

      // Unmatched students report
      const unmatchedStudents = records.filter(r => r.attendance === 'Pending' || r.attendance === 'Absent' || r.attendance === 'Unknown');

      return res.json({
        success: true,
        stats: {
          contestName: contest ? contest.contestName : 'LeetCode Contest',
          contestSlug: slug,
          totalRegistered,
          present: presentCount,
          absent: absentCount,
          pending: pendingCount,
          downloadedParticipants: effectiveDownloaded,
          lastSyncTime: contest ? contest.lastSyncAt : null,
          nextScheduledSync: nextSyncTime,
          syncDurationMs: syncLog && syncLog.completed_at && syncLog.started_at ? (new Date(syncLog.completed_at) - new Date(syncLog.started_at)) : 0,
          apiRequests: syncLog ? syncLog.total_requests : 0,
          cacheStatus,
          retryCount: syncLog ? syncLog.retry_count : 0,
          cacheSize,
          attendanceFinalized: contest ? (contest.status === 'Completed' && !!contest.lastSyncAt) : false,
          attendancePercentage
        },
        records: records || [],
        unmatchedStudents: unmatchedStudents.map(u => ({
          name: u.student_name,
          roll_no: u.roll_no,
          leetcode_username: u.leetcode_username,
          department: u.department,
          section: u.section,
          status: u.attendance
        }))
      });
    } catch (error) {
      console.error(`[Contest Records Fetch Error]:`, error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve contest attendance records.'
      });
    }
  },

  /**
   * Post endpoint to import contest attendance from CSV/Excel spreadsheet data
   */
  async importCsv(req, res) {
    const { contestSlug, rows, filename } = req.body;
    if (!contestSlug || typeof contestSlug !== 'string' || !contestSlug.trim()) {
      return res.status(400).json({ success: false, message: 'contestSlug parameter is required.' });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'rows parameter must be a non-empty array of parsed spreadsheet objects.' });
    }

    try {
      const ContestImportService = require('../services/contestImportService');
      const result = await ContestImportService.importContestAttendance({
        contestSlug: contestSlug.trim().toLowerCase(),
        rows,
        filename: filename || 'upload.csv',
        uploadedBy: req.user?.username || 'ADMIN_API'
      });

      return res.json({
        success: true,
        message: `Successfully imported CSV attendance for contest '${contestSlug}'! Processed: ${result.processedRows}, Rejected: ${result.rejectedRows}`,
        data: result
      });
    } catch (error) {
      console.error(`[CSV Import Controller Error]:`, error);
      return res.status(500).json({
        success: false,
        message: `CSV import failed: ${error.message}`
      });
    }
  }
};

module.exports = LeetCodeContestAttendanceController;
