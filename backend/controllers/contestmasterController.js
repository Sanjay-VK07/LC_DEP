const db = require('../config/db');
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
  let { studentId = 'all', batch, type, status, startDate, endDate } = req.query;

  // Normalize batch YYYY-YYYY format to YYYY-YY
  batch = normalizeBatchToShort(batch);

  const validPlatforms = ['leetcode', 'codechef', 'codeforces'];
  if (!validPlatforms.includes(platform.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Invalid platform specified.' });
  }

  // Format platform name for DB query matching (enum is 'LeetCode', 'CodeChef', 'Codeforces')
  const dbPlatformMap = {
    leetcode: 'LeetCode',
    codechef: 'CodeChef',
    codeforces: 'Codeforces'
  };
  const dbPlatform = dbPlatformMap[platform.toLowerCase()];

  // ── AUTOMATIC ON-DEMAND SYNC CHECK ──
  try {
    const unsyncedContests = await db.query(
      `SELECT contest_id, title 
       FROM Contests 
       WHERE platform = ? AND contest_status != 'Cancelled'
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

  const profileTableMap = {
    leetcode: 'LeetCodeProfiles',
    codechef: 'CodeChefProfiles',
    codeforces: 'CodeforcesProfiles'
  };
  const profileTable = profileTableMap[platform.toLowerCase()];

  try {
    // 1. Determine student or batch boundaries
    let eligibilityStart = null;
    let eligibilityEnd = new Date();
    let studentInfo = null;

    if (studentId !== 'all') {
      const studentRows = await db.query(
        "SELECT id, name, roll_no, department, section, academic_batch, academic_start_date, academic_end_date, leetcode_username, codechef_username, codeforces_username FROM Users WHERE id = ?",
        [studentId]
      );
      if (studentRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Student not found.' });
      }
      studentInfo = studentRows[0];
      eligibilityStart = parseDateOnly(studentInfo.academic_start_date);
      eligibilityEnd = parseDateOnly(studentInfo.academic_end_date);
      eligibilityEnd.setHours(23, 59, 59, 999);
    } else if (batch) {
      const dateRows = await db.query(
        "SELECT MIN(academic_start_date) as start_date, MAX(academic_end_date) as end_date FROM Users WHERE academic_batch = ? AND status = 'active'",
        [batch]
      );
      if (dateRows.length > 0 && dateRows[0].start_date) {
        eligibilityStart = parseDateOnly(dateRows[0].start_date);
        eligibilityEnd = parseDateOnly(dateRows[0].end_date);
        eligibilityEnd.setHours(23, 59, 59, 999);
      } else {
        eligibilityStart = new Date('2023-07-01');
      }
    } else {
      eligibilityStart = new Date('2023-07-01');
    }

    // 2. Fetch platform username and rating history if student-specific
    let attendedTitles = new Set();
    let attendedSlugs = new Set();
    let rawHistory = [];
    let platformRanking = null;

    if (studentId !== 'all') {
      let profileRows = [];
      if (platform.toLowerCase() === 'codeforces') {
        profileRows = await db.query(
          `SELECT current_rating, highest_rating, contest_history FROM CodeforcesProfiles WHERE user_id = ?`,
          [studentId]
        );
      } else {
        profileRows = await db.query(
          `SELECT current_rating, highest_rating, global_ranking, contest_history FROM ${profileTable} WHERE user_id = ?`,
          [studentId]
        );
      }
      const profile = profileRows.length > 0 ? profileRows[0] : null;
      rawHistory = profile && profile.contest_history ? parseContestHistory(profile.contest_history) : [];

      if (platform.toLowerCase() === 'leetcode') {
        const normalized = rawHistory.map(normalizeLeetCodeEntry);
        normalized.forEach(e => {
          if (e.attended && e.contestName) attendedTitles.add(e.contestName.trim().toLowerCase());
          if (e.attended && e.contestSlug) attendedSlugs.add(e.contestSlug.trim().toLowerCase());
        });
        if (profile) {
          platformRanking = {
            rating: parseFloat(profile.current_rating || 1500),
            globalRanking: profile.global_ranking,
            attendedContestsCount: normalized.filter(e => e.attended).length
          };
        }
      } else if (platform.toLowerCase() === 'codechef') {
        const normalized = rawHistory.map(normalizeCodeChefEntry);
        normalized.forEach(e => {
          if (e.attended && e.contestName) attendedTitles.add(e.contestName.trim().toLowerCase());
        });
        if (profile) {
          platformRanking = {
            rating: profile.current_rating || 0,
            highestRating: profile.highest_rating || 0,
            globalRanking: profile.global_ranking || null,
            attendedContestsCount: normalized.filter(e => e.attended).length
          };
        }
      } else if (platform.toLowerCase() === 'codeforces') {
        const normalized = rawHistory.map(normalizeCodeforcesEntry);
        normalized.forEach(e => {
          if (e.attended && e.contestName) attendedTitles.add(e.contestName.trim().toLowerCase());
        });
        if (profile) {
          const detailRows = await db.query(
            "SELECT `rank`, max_rank FROM CodeforcesProfiles WHERE user_id = ?",
            [studentId]
          );
          platformRanking = {
            rating: profile.current_rating || 0,
            highestRating: profile.highest_rating || 0,
            rank: detailRows.length > 0 ? detailRows[0].rank : null,
            maxRank: detailRows.length > 0 ? detailRows[0].max_rank : null,
            attendedContestsCount: normalized.length
          };
        }
      }
    }

    // 3. Scoping registration and attendance count dynamically to active batch users
    let regCountSubquery = "SELECT COUNT(*) FROM Registrations r JOIN Users u ON r.user_id = u.id WHERE r.contest_id = c.contest_id AND u.status = 'active'";
    let attCountSubquery = "SELECT COUNT(*) FROM ParticipationLogs p JOIN Users u ON p.user_id = u.id WHERE p.contest_id = c.contest_id AND u.status = 'active'";
    const countParams = [];
    
    if (batch) {
      regCountSubquery += " AND u.academic_batch = ?";
      attCountSubquery += " AND u.academic_batch = ?";
      countParams.push(batch, batch);
    }

    const dbContests = await db.query(
      `SELECT c.contest_id, c.title as contest_name, c.slug as contest_slug, c.start_time as contest_date, c.contest_status, c.contest_type, c.duration, c.platform,
              ar.attendance_status, ar.attendance_source, ar.remarks, ar.last_updated,
              (SELECT COUNT(*) FROM Registrations r WHERE r.contest_id = c.contest_id AND r.user_id = ?) as is_registered,
              (SELECT COUNT(*) FROM ParticipationLogs p WHERE p.contest_id = c.contest_id AND p.user_id = ?) as is_joined,
              (${regCountSubquery}) as registration_count,
              (${attCountSubquery}) as attendance_count
       FROM Contests c
       LEFT JOIN AttendanceRecords ar ON c.contest_id = ar.contest_id AND ar.user_id = ?
       WHERE c.platform = ?
       ORDER BY c.start_time DESC`,
      [
        studentId === 'all' ? 0 : studentId,
        studentId === 'all' ? 0 : studentId,
        ...countParams,
        studentId === 'all' ? 0 : studentId,
        dbPlatform
      ]
    );

    // 4. Map and Filter contests
    let contests = dbContests.map(item => {
      const contestDate = new Date(item.contest_date);
      const isEligible = contestDate >= eligibilityStart && contestDate <= eligibilityEnd;
      
      const timing = getContestTiming(item.contest_date, item.duration || 5400);
      const isOngoing = timing === 'active';
      const isUnrated = item.contest_status && item.contest_status.toUpperCase() === 'UNRATED';
      
      let hasAttended = false;
      if (studentId !== 'all') {
        if (item.attendance_source === 'MANUAL' && item.attendance_status) {
          hasAttended = item.attendance_status === 'PRESENT';
        } else {
          const nameMatch = attendedTitles.has(item.contest_name.trim().toLowerCase());
          const slugMatch = item.contest_slug ? attendedSlugs.has(item.contest_slug.trim().toLowerCase()) : false;
          
          let cfMatch = false;
          if (platform.toLowerCase() === 'codeforces' && item.contest_slug) {
            const cfContestIdMatch = item.contest_slug.match(/codeforces-(\d+)/);
            if (cfContestIdMatch) {
              const cfId = parseInt(cfContestIdMatch[1]);
              cfMatch = rawHistory.some(h => h.contestId === cfId);
            }
          }
          
          hasAttended = nameMatch || slugMatch || cfMatch || item.is_joined > 0;
        }
      }

      let attendanceStatus = 'ABSENT';
      if (!isEligible) {
        attendanceStatus = 'NOT_APPLICABLE';
      } else if (isOngoing) {
        attendanceStatus = 'ONGOING';
      } else if (isUnrated) {
        attendanceStatus = 'UNRATED';
      } else if (hasAttended) {
        attendanceStatus = 'PRESENT';
      } else {
        attendanceStatus = 'ABSENT';
      }

      let perfMatch = null;
      if (studentId !== 'all') {
        if (platform.toLowerCase() === 'leetcode') {
          perfMatch = rawHistory.find(h => 
            (h.contest && h.contest.title?.trim().toLowerCase() === item.contest_name.trim().toLowerCase()) ||
            (h.contest && h.contest.titleSlug?.trim().toLowerCase() === item.contest_slug?.trim().toLowerCase())
          );
        } else if (platform.toLowerCase() === 'codechef') {
          perfMatch = rawHistory.find(h => 
            (h.contestName || '').trim().toLowerCase() === item.contest_name.trim().toLowerCase()
          );
        } else if (platform.toLowerCase() === 'codeforces') {
          const cfContestIdMatch = item.contest_slug ? item.contest_slug.match(/codeforces-(\d+)/) : null;
          const cfId = cfContestIdMatch ? parseInt(cfContestIdMatch[1]) : -1;
          perfMatch = rawHistory.find(h => 
            h.contestId === cfId || (h.contestName || '').trim().toLowerCase() === item.contest_name.trim().toLowerCase()
          );
        }
      }

      let problems_solved = null;
      let total_problems = null;
      let global_rank = null;
      let rating = null;
      let rating_change = null;

      if (perfMatch) {
        if (platform.toLowerCase() === 'leetcode') {
          problems_solved = perfMatch.problemsSolved;
          total_problems = perfMatch.totalProblems || 4;
          global_rank = perfMatch.ranking;
          rating = perfMatch.rating ? Math.round(perfMatch.rating) : null;
          rating_change = perfMatch.ratingChange ? parseFloat(perfMatch.ratingChange) : 0;
        } else if (platform.toLowerCase() === 'codechef') {
          global_rank = perfMatch.rank;
          rating = perfMatch.newRating;
          rating_change = perfMatch.ratingChange || 0;
        } else if (platform.toLowerCase() === 'codeforces') {
          global_rank = perfMatch.rank;
          rating = perfMatch.newRating;
          rating_change = (perfMatch.newRating && perfMatch.oldRating) ? (perfMatch.newRating - perfMatch.oldRating) : 0;
        }
      } else if (attendanceStatus === 'PRESENT') {
        problems_solved = platform.toLowerCase() === 'leetcode' ? 4 : null;
        total_problems = platform.toLowerCase() === 'leetcode' ? 4 : null;
      }

      // Map dynamic, platform-specific categories into type field
      let resolvedType = item.contest_type ? item.contest_type.toLowerCase() : 'weekly';
      const nameLower = item.contest_name.toLowerCase();
      if (platform.toLowerCase() === 'codechef') {
        resolvedType = 'starters';
        if (nameLower.includes('cook-off') || nameLower.includes('cook')) resolvedType = 'cook-off';
        else if (nameLower.includes('lunchtime')) resolvedType = 'lunchtime';
        else if (nameLower.includes('long challenge') || nameLower.includes('long')) resolvedType = 'long challenge';
      } else if (platform.toLowerCase() === 'codeforces') {
        resolvedType = 'div2';
        if (nameLower.includes('div 1') || nameLower.includes('div. 1')) resolvedType = 'div1';
        else if (nameLower.includes('div 2') || nameLower.includes('div. 2')) resolvedType = 'div2';
        else if (nameLower.includes('div 3') || nameLower.includes('div. 3')) resolvedType = 'div3';
        else if (nameLower.includes('div 4') || nameLower.includes('div. 4')) resolvedType = 'div4';
        else if (nameLower.includes('educational')) resolvedType = 'educational';
        else if (nameLower.includes('global')) resolvedType = 'global';
      }

      return {
        id: item.contest_id,
        contest_id: item.contest_slug,
        name: item.contest_name,
        date: item.contest_date,
        type: resolvedType,
        status: attendanceStatus === 'PRESENT' ? 'attended' : (attendanceStatus === 'ABSENT' ? 'not attended' : attendanceStatus.toLowerCase()),
        attendance_status: attendanceStatus,
        attendance_source: item.attendance_source,
        eligibility_status: isEligible ? 'Eligible' : 'Outside Academic Period',
        remarks: item.remarks,
        last_updated: item.last_updated,
        global_rank,
        rating,
        rating_change,
        problems_solved,
        total_problems,
        is_registered: item.is_registered > 0 || attendanceStatus === 'PRESENT',
        is_joined: item.is_joined > 0 || attendanceStatus === 'PRESENT',
        registration_count: item.registration_count || 0,
        attendance_count: item.attendance_count || 0
      };
    });

    // 5. Apply filters
    if (type) {
      contests = contests.filter(c => c.type === type.toLowerCase());
    }
    if (startDate) {
      const startLimit = new Date(startDate);
      contests = contests.filter(c => new Date(c.date) >= startLimit);
    }
    if (endDate) {
      const endLimit = new Date(endDate);
      contests = contests.filter(c => new Date(c.date) <= endLimit);
    }
    if (status) {
      contests = contests.filter(c => {
        if (status === 'present') return c.attendance_status === 'PRESENT';
        if (status === 'absent') return c.attendance_status === 'ABSENT';
        return c.attendance_status.toLowerCase() === status.toLowerCase();
      });
    }

    // 6. Calculate Platform Statistics (strictly from platform contests)
    const eligibleContestsList = contests.filter(c => c.eligibility_status === 'Eligible');
    const ratedEligibleRecords = eligibleContestsList.filter(c => c.attendance_status === 'PRESENT' || c.attendance_status === 'ABSENT');
    const totalRated = ratedEligibleRecords.length;
    const ongoing = eligibleContestsList.filter(c => c.attendance_status === 'ONGOING').length;

    let batchStudentsCount = 1;
    if (studentId === 'all') {
      const studentCountRows = await db.query(
        `SELECT COUNT(*) as count FROM Users WHERE status = 'active' ${batch ? 'AND academic_batch = ?' : ''}`,
        batch ? [batch] : []
      );
      batchStudentsCount = studentCountRows[0]?.count || 1;
    }

    let attended = 0;
    let attendancePercentage = 100.0;

    if (studentId !== 'all') {
      attended = ratedEligibleRecords.filter(c => c.attendance_status === 'PRESENT').length;
      attendancePercentage = totalRated > 0 ? parseFloat(Math.min(100, (attended / totalRated) * 100).toFixed(1)) : 100.0;
    } else {
      const totalAttended = ratedEligibleRecords.reduce((acc, c) => acc + (c.attendance_count || 0), 0);
      const totalPossible = batchStudentsCount * totalRated;
      attendancePercentage = totalPossible > 0 ? parseFloat(Math.min(100, (totalAttended / totalPossible) * 100).toFixed(1)) : 100.0;
      attended = Math.round(totalRated * (attendancePercentage / 100));
    }

    const missed = Math.max(0, totalRated - attended);

    const metrics = {
      eligible: totalRated,
      attended: Math.min(totalRated, attended),
      missed,
      rate: attendancePercentage,
      ongoing
    };

    // 7. Monthly Attendance Trend (Strictly using this platform's contests)
    const monthlyGroups = {};
    eligibleContestsList.forEach(item => {
      const d = new Date(item.date);
      if (isNaN(d.getTime())) return;
      
      const year = d.getFullYear();
      const monthVal = d.getMonth();
      const monthKey = `${year}-${String(monthVal + 1).padStart(2, '0')}`;
      
      if (!monthlyGroups[monthKey]) {
        monthlyGroups[monthKey] = {
          key: monthKey,
          monthName: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          present: 0,
          total: 0
        };
      }
      
      const group = monthlyGroups[monthKey];
      if (studentId !== 'all') {
        group.total++;
        if (item.attendance_status === 'PRESENT') {
          group.present++;
        }
      } else {
        group.present += (item.attendance_count || 0);
        group.total += batchStudentsCount;
      }
    });

    const monthlyTrendData = Object.values(monthlyGroups)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(g => ({
        name: g.monthName,
        rate: g.total > 0 ? Math.round((g.present / g.total) * 100) : 0,
        present: g.present,
        total: g.total
      }))
      .slice(-24);

    // 8. Semester Analytics (Strictly using this platform's contests)
    let semesterStart = eligibilityStart || new Date('2023-07-01');
    if (studentId !== 'all' && studentInfo?.academic_start_date) {
      semesterStart = new Date(studentInfo.academic_start_date);
    } else if (batch) {
      const startYear = parseInt(batch.split('-')[0], 10);
      semesterStart = !isNaN(startYear) ? new Date(`${startYear}-07-01`) : new Date('2024-07-01');
    }

    const semestersData = {};
    for (let i = 1; i <= 8; i++) {
      semestersData[i] = {
        semester: `Sem ${i}`,
        semesterNum: i,
        total: 0,
        present: 0,
        absent: 0
      };
    }

    eligibleContestsList.forEach(item => {
      const d = new Date(item.date);
      if (isNaN(d.getTime())) return;
      
      const startYear = semesterStart.getFullYear();
      const startMonth = semesterStart.getMonth();
      const itemYear = d.getFullYear();
      const itemMonth = d.getMonth();
      
      const monthsDiff = (itemYear - startYear) * 12 + (itemMonth - startMonth);
      if (monthsDiff < 0) return;
      
      const sem = Math.floor(monthsDiff / 6) + 1;
      if (sem < 1 || sem > 8) return;
      
      const group = semestersData[sem];
      if (studentId !== 'all') {
        group.total++;
        if (item.attendance_status === 'PRESENT') {
          group.present++;
        } else {
          group.absent++;
        }
      } else {
        group.present += (item.attendance_count || 0);
        group.total += batchStudentsCount;
        group.absent += Math.max(0, batchStudentsCount - (item.attendance_count || 0));
      }
    });

    const semesterAnalyticsData = Object.values(semestersData).map(s => {
      let total = s.total;
      let present = s.present;
      let absent = s.absent;
      
      if (studentId === 'all') {
        total = Math.round(s.total / batchStudentsCount);
        present = Math.round(s.present / batchStudentsCount);
        absent = Math.round(s.absent / batchStudentsCount);
      }
      
      const rate = total > 0 ? parseFloat(((present / total) * 100).toFixed(1)) : 0;
      return {
        semester: s.semester,
        semesterNum: s.semesterNum,
        total,
        present,
        absent,
        rate
      };
    });

    // 9. Batch Comparison (Strictly using this platform's metrics)
    let targetBatches = [];
    if (batch) {
      targetBatches = [batch];
    } else {
      const activeBatchesList = await db.query(
        `SELECT DISTINCT academic_batch 
         FROM Users 
         WHERE status = 'active' 
           AND academic_batch IS NOT NULL 
           AND academic_batch != ''
         ORDER BY academic_batch ASC`
      );
      targetBatches = activeBatchesList.map(item => item.academic_batch);
    }

    const batchComparisonData = await Promise.all(targetBatches.map(async (b) => {
      const studentsInBatch = await db.query(
        `SELECT u.id, u.name, ROUND(IFNULL(p.current_rating, ${platform.toLowerCase() === 'leetcode' ? 1500 : 0})) as rating
         FROM Users u
         LEFT JOIN ${profileTable} p ON u.id = p.user_id
         WHERE u.academic_batch = ? AND u.status = 'active'`,
        [b]
      );
      const totalStudents = studentsInBatch.length;

      let avgAttendance = 0;
      let avgRating = platform.toLowerCase() === 'leetcode' ? 1500 : 0;

      if (totalStudents > 0) {
        const studentIdsInBatch = studentsInBatch.map(s => s.id);
        const attStats = await db.query(
          `SELECT 
             COUNT(CASE WHEN ar.attendance_status = 'PRESENT' THEN 1 END) as attended,
             COUNT(CASE WHEN ar.attendance_status IN ('PRESENT', 'ABSENT') THEN 1 END) as total
           FROM AttendanceRecords ar
           JOIN Contests c ON ar.contest_id = c.contest_id
           WHERE ar.user_id IN (${studentIdsInBatch.join(',')}) AND c.platform = ? AND c.contest_status = 'Rated'`,
          [dbPlatform]
        );
        
        const totalEligibleRecords = attStats[0]?.total || 0;
        const totalAttendedRecords = attStats[0]?.attended || 0;
        
        avgAttendance = totalEligibleRecords > 0 
          ? parseFloat(((totalAttendedRecords / totalEligibleRecords) * 100).toFixed(1))
          : 0;

        avgRating = Math.round(studentsInBatch.reduce((acc, s) => acc + s.rating, 0) / totalStudents);
      }

      return {
        name: formatBatchToLong(b),
        attendance: avgAttendance,
        rating: avgRating,
        participants: totalStudents
      };
    }));

    // 10. Student Summaries (Strictly using this platform's metrics)
    let studentSummariesFilter = '';
    const studentSummaryParams = [dbPlatform, dbPlatform];
    if (batch) {
      studentSummariesFilter += ' AND u.academic_batch = ?';
      studentSummaryParams.push(batch);
    }
    
    const ratingCol = 'p.current_rating';
    const highestRatingCol = 'p.highest_rating';

    const studentSummariesRows = await db.query(
      `SELECT u.id, u.name, u.roll_no as register_number, u.department, u.section, u.academic_batch as academic_year,
              ROUND(IFNULL(${ratingCol}, ${platform.toLowerCase() === 'leetcode' ? 1500 : 0})) as current_rating,
              ROUND(IFNULL(${highestRatingCol}, ${platform.toLowerCase() === 'leetcode' ? 1500 : 0})) as best_rating,
              (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Contests c ON ar.contest_id = c.contest_id
               WHERE ar.user_id = u.id AND c.platform = ? AND c.contest_status = 'Rated' AND ar.attendance_status IN ('PRESENT', 'ABSENT')) as total_eligible,
              (SELECT COUNT(*) FROM AttendanceRecords ar JOIN Contests c ON ar.contest_id = c.contest_id
               WHERE ar.user_id = u.id AND c.platform = ? AND c.contest_status = 'Rated' AND ar.attendance_status = 'PRESENT') as attended_count
       FROM Users u
       LEFT JOIN ${profileTable} p ON u.id = p.user_id
       WHERE u.status = 'active'${studentSummariesFilter}
       ORDER BY u.department, u.section, u.roll_no`,
      studentSummaryParams
    );

    const studentSummaries = studentSummariesRows.map(r => {
      const eligible = r.total_eligible || 0;
      const attended = r.attended_count || 0;
      const rate = eligible > 0 ? Math.round((attended / eligible) * 100) : 0;
      return {
        id: r.id,
        name: r.name,
        register_number: r.register_number,
        department: r.department,
        section: r.section,
        academic_year: r.academic_year,
        current_rating: r.current_rating,
        best_rating: r.best_rating,
        total_eligible: eligible,
        attended_count: attended,
        absent_count: Math.max(0, eligible - attended),
        attendance_percentage: rate
      };
    });

    return res.json({
      success: true,
      platform: platform.toLowerCase(),
      metrics,
      contests,
      monthlyTrendData,
      semesterAnalyticsData,
      batchComparisonData,
      studentSummaries,
      platformRanking
    });

  } catch (error) {
    console.error(`[ContestMasterController] Error fetching ${platform} analytics:`, error);
    return res.status(500).json({ success: false, message: `Failed to retrieve ${platform} analytics dashboard data.` });
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
