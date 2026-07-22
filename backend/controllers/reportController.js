const db = require('../config/db');
const cache = require('../services/analyticsCacheService');

// Helper to parse dates timezone-independently
function parseDateOnly(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  let dateStr;
  if (dateInput instanceof Date) {
    const year = dateInput.getFullYear();
    const month = String(dateInput.getMonth() + 1).padStart(2, '0');
    const day = String(dateInput.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
  } else if (typeof dateInput === 'string') {
    dateStr = dateInput.substring(0, 10);
  } else {
    const year = d.getFullYear();
    const month = String(dateInput.getMonth() + 1).padStart(2, '0');
    const day = String(dateInput.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
  }
  const parts = dateStr.split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0, 0);
}

// 1. Get Faculty Dashboard Statistics
async function getDashboardStats(req, res) {
  const { platform } = req.query;
  const filterPlatform = platform ? platform.toLowerCase() : 'all';
  const cacheKey = `dashboard:stats:${filterPlatform}`;

  try {
    const data = await cache.getOrCompute(cacheKey, async () => {
      // Total Students (Active)
      const [totalStudentsResult] = await db.query(
        "SELECT COUNT(*) as count FROM Users WHERE status = 'active'"
      );
      const totalStudents = totalStudentsResult ? totalStudentsResult.count : 0;

      // Fetch all contests counts
      let contestsSql = "SELECT contest_status, contest_type FROM Contests";
      const contestsParams = [];
      if (filterPlatform !== 'all') {
        contestsSql += " WHERE platform = ?";
        contestsParams.push(filterPlatform === 'codechef' ? 'CodeChef' : 'LeetCode');
      }
      const contestsResult = await db.query(contestsSql, contestsParams);
      
      const totalContests = contestsResult.length;
      const ratedContests = contestsResult.filter(c => c.contest_status === 'Rated').length;
      const unratedContests = contestsResult.filter(c => c.contest_status === 'Unrated').length;
      const cancelledContests = contestsResult.filter(c => c.contest_status === 'Cancelled').length;
      const weeklyContests = contestsResult.filter(c => c.contest_type === 'Weekly').length;
      const biweeklyContests = contestsResult.filter(c => c.contest_type === 'Biweekly').length;

      // Overall Attendance Percentage
      const platformFilterStr = filterPlatform === 'all' ? '' : (filterPlatform === 'codechef' ? " AND c.platform = 'CodeChef'" : " AND c.platform = 'LeetCode'");
      const [attendancePercentResult] = await db.query(
        `SELECT 
           COUNT(*) as total_regs,
           SUM(CASE WHEN ar.attendance_status = 'PRESENT' THEN 1 ELSE 0 END) as total_parts
         FROM AttendanceRecords ar
         JOIN Contests c ON ar.contest_id = c.contest_id
         JOIN Users u ON ar.user_id = u.id
         WHERE c.contest_status = 'Rated'${platformFilterStr}
           AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND <= NOW()
           AND u.status = 'active'
           AND c.start_time >= u.academic_start_date 
           AND c.start_time <= u.academic_end_date
           AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
           AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
           AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
           AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
           AND c.slug NOT LIKE '%internal-%'`
      );
      const totalRegs = attendancePercentResult ? attendancePercentResult.total_regs : 0;
      const totalParts = attendancePercentResult ? attendancePercentResult.total_parts : 0;
      const overallAttendance = totalRegs > 0 ? Math.round((totalParts / totalRegs) * 100) : 0;

      // Average Rating
      const profileTable = filterPlatform === 'codechef' ? 'CodeChefProfiles' : 'LeetCodeProfiles';
      const [avgRatingResult] = await db.query(
        `SELECT AVG(current_rating) as avgRating FROM ${profileTable} lp JOIN Users u ON lp.user_id = u.id WHERE u.status = 'active'`
      );
      const averageRating = avgRatingResult && avgRatingResult.avgRating ? Math.round(avgRatingResult.avgRating) : 1500;

      // Recently Synced Records
      const [latestSyncResult] = await db.query(
        "SELECT completed_at, contests_synced, students_processed FROM sync_logs WHERE status = 'success' ORDER BY started_at DESC LIMIT 1"
      );
      const recentlySynced = latestSyncResult ? {
        time: latestSyncResult.completed_at,
        contests: latestSyncResult.contests_synced,
        students: latestSyncResult.students_processed
      } : null;

      // Department-wise Stats
      const deptStats = await db.query(
        `SELECT u.department, 
                COUNT(DISTINCT u.id) as total_students,
                IFNULL((
                  SELECT COUNT(*) 
                  FROM AttendanceRecords ar 
                  JOIN Users u2 ON ar.user_id = u2.id 
                  JOIN Contests c ON ar.contest_id = c.contest_id 
                  WHERE u2.department = u.department 
                    AND u2.status = 'active'
                    AND c.contest_status = 'Rated'${platformFilterStr}
                    AND c.start_time >= u2.academic_start_date 
                    AND c.start_time <= u2.academic_end_date
                    AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND <= NOW()
                    AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
                    AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
                    AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
                    AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
                    AND c.slug NOT LIKE '%internal-%'
                ), 0) as total_records,
                IFNULL((
                  SELECT COUNT(*) 
                  FROM AttendanceRecords ar 
                  JOIN Users u3 ON ar.user_id = u3.id 
                  JOIN Contests c ON ar.contest_id = c.contest_id 
                  WHERE u3.department = u.department 
                    AND u3.status = 'active'
                    AND ar.attendance_status = 'PRESENT'
                    AND c.contest_status = 'Rated'${platformFilterStr}
                    AND c.start_time >= u3.academic_start_date 
                    AND c.start_time <= u3.academic_end_date
                    AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND <= NOW()
                    AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
                    AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
                    AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
                    AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
                    AND c.slug NOT LIKE '%internal-%'
                ), 0) as present_count
         FROM Users u
         WHERE u.status = 'active'
         GROUP BY u.department`
      );

      const departmentStats = deptStats.map(d => ({
        department: d.department,
        totalStudents: d.total_students,
        attendancePercentage: d.total_records > 0 ? Math.round((d.present_count / d.total_records) * 100) : 100
      }));

      // Weekly Participation Trend (last 10 contests)
      let weeklyTrendSql = `
         SELECT c.title as name, c.start_time as date, c.platform,
                (
                  SELECT COUNT(DISTINCT ar.user_id) 
                  FROM AttendanceRecords ar 
                  JOIN Users u ON ar.user_id = u.id
                  WHERE ar.contest_id = c.contest_id 
                    AND ar.attendance_status = 'PRESENT'
                    AND u.status = 'active'
                    AND c.start_time >= u.academic_start_date 
                    AND c.start_time <= u.academic_end_date
                ) as present_count,
                (
                  SELECT COUNT(*) 
                  FROM Users u
                  WHERE u.status = 'active'
                    AND c.start_time >= u.academic_start_date 
                    AND c.start_time <= u.academic_end_date
                ) as total_students
         FROM Contests c
      `;
      const weeklyTrendParams = [];
      let whereClause = ` WHERE c.contest_status = 'Rated'
        AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
        AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
        AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
        AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
        AND c.slug NOT LIKE '%internal-%' `;

      if (filterPlatform !== 'all') {
        whereClause += ` AND c.platform = ? `;
        weeklyTrendParams.push(filterPlatform === 'codechef' ? 'CodeChef' : 'LeetCode');
      }
      weeklyTrendSql += whereClause + ` ORDER BY c.start_time DESC LIMIT 10 `;

      const weeklyTrend = await db.query(weeklyTrendSql, weeklyTrendParams);
      weeklyTrend.reverse();

      // Top Active Students (highest current rating)
      const topStudents = await db.query(
        `SELECT u.id, u.name, u.roll_no as register_number, u.leetcode_username, u.codechef_username, u.department,
                (
                  SELECT COUNT(DISTINCT ar.contest_id) 
                  FROM AttendanceRecords ar 
                  JOIN Contests c ON ar.contest_id = c.contest_id 
                  WHERE ar.user_id = u.id 
                    AND ar.attendance_status = 'PRESENT'
                    AND c.contest_status = 'Rated'${platformFilterStr}
                    AND c.start_time >= u.academic_start_date 
                    AND c.start_time <= u.academic_end_date
                    AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
                    AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
                    AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
                    AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
                    AND c.slug NOT LIKE '%internal-%'
                ) as present_count,
                (
                  SELECT COUNT(DISTINCT ar.contest_id) 
                  FROM AttendanceRecords ar 
                  JOIN Contests c ON ar.contest_id = c.contest_id 
                  WHERE ar.user_id = u.id 
                    AND c.contest_status = 'Rated'${platformFilterStr}
                    AND c.start_time >= u.academic_start_date 
                    AND c.start_time <= u.academic_end_date
                    AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
                    AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
                    AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
                    AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
                    AND c.slug NOT LIKE '%internal-%'
                ) as total_contests,
                ROUND(IFNULL(lp.current_rating, 1500)) as current_rating
         FROM Users u
         LEFT JOIN ${profileTable} lp ON u.id = lp.user_id
         WHERE u.status = 'active'
         ORDER BY current_rating DESC, present_count DESC
         LIMIT 5`
      );

      // Students with Low Attendance (< 10%)
      const lowAttendanceStudents = await db.query(
        `SELECT u.id, u.name, u.roll_no as register_number, u.department, u.section,
                (
                  SELECT COUNT(DISTINCT ar.contest_id) 
                  FROM AttendanceRecords ar 
                  JOIN Contests c ON ar.contest_id = c.contest_id 
                  WHERE ar.user_id = u.id 
                    AND c.contest_status = 'Rated'${platformFilterStr}
                    AND c.start_time >= u.academic_start_date 
                    AND c.start_time <= u.academic_end_date
                    AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
                    AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
                    AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
                    AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
                    AND c.slug NOT LIKE '%internal-%'
                ) as total_contests,
                (
                  SELECT COUNT(DISTINCT ar.contest_id) 
                  FROM AttendanceRecords ar 
                  JOIN Contests c ON ar.contest_id = c.contest_id 
                  WHERE ar.user_id = u.id 
                    AND ar.attendance_status = 'PRESENT'
                    AND c.contest_status = 'Rated'${platformFilterStr}
                    AND c.start_time >= u.academic_start_date 
                    AND c.start_time <= u.academic_end_date
                    AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
                    AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
                    AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
                    AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
                    AND c.slug NOT LIKE '%internal-%'
                ) as present_count,
                ROUND(
                  (
                    SELECT COUNT(DISTINCT ar.contest_id) 
                    FROM AttendanceRecords ar 
                    JOIN Contests c ON ar.contest_id = c.contest_id 
                    WHERE ar.user_id = u.id 
                      AND ar.attendance_status = 'PRESENT'
                      AND c.contest_status = 'Rated'${platformFilterStr}
                      AND c.start_time >= u.academic_start_date 
                      AND c.start_time <= u.academic_end_date
                      AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
                      AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
                      AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
                      AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
                      AND c.slug NOT LIKE '%internal-%'
                  ) / NULLIF(
                    (
                      SELECT COUNT(DISTINCT ar.contest_id) 
                      FROM AttendanceRecords ar 
                      JOIN Contests c ON ar.contest_id = c.contest_id 
                      WHERE ar.user_id = u.id 
                        AND c.contest_status = 'Rated'${platformFilterStr}
                        AND c.start_time >= u.academic_start_date 
                        AND c.start_time <= u.academic_end_date
                        AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
                        AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
                        AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
                        AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
                        AND c.slug NOT LIKE '%internal-%'
                    ), 0
                  ) * 100
                ) as attendance_percentage
         FROM Users u
         WHERE u.status = 'active' 
           AND (
             SELECT COUNT(DISTINCT ar.contest_id) 
             FROM AttendanceRecords ar 
             JOIN Contests c ON ar.contest_id = c.contest_id 
             WHERE ar.user_id = u.id 
               AND c.contest_status = 'Rated'${platformFilterStr}
               AND c.start_time >= u.academic_start_date 
               AND c.start_time <= u.academic_end_date
               AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
               AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
               AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
               AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
               AND c.slug NOT LIKE '%internal-%'
           ) >= 3 
         HAVING attendance_percentage < 10
         ORDER BY attendance_percentage ASC
         LIMIT 10`
      );

      // Recently Added Contests (last 2 weeks)
      let recentContestsSql = `
         SELECT title as name, start_time as date, platform
         FROM Contests 
         WHERE start_time >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
      `;
      const recentContestsParams = [];
      if (filterPlatform !== 'all') {
        recentContestsSql += ` AND platform = ? `;
        recentContestsParams.push(filterPlatform === 'codechef' ? 'CodeChef' : 'LeetCode');
      }
      recentContestsSql += ` ORDER BY start_time DESC `;

      const recentContests = await db.query(recentContestsSql, recentContestsParams);

      return {
        success: true,
        stats: {
          totalStudents,
          totalActiveStudents: totalStudents,
          totalContests,
          ratedContests,
          unratedContests,
          cancelledContests,
          weeklyContests,
          biweeklyContests,
          overallAttendance,
          averageRating,
          recentlySynced
        },
        departmentStats,
        weeklyTrend,
        topStudents,
        alerts: {
          missingUploads: [],
          lowAttendanceStudents,
          recentContests
        }
      };
    }, 15 * 60 * 1000); // Cache for 15 minutes

    return res.json(data);
  } catch (error) {
    console.error('Error generating dashboard stats:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// 2. Get Contest-wise Summary Report
async function getContestsReport(req, res) {
  const { batch, platform } = req.query;
  const filterPlatform = platform ? platform.toLowerCase() : 'all';
  const platformFilterStr = filterPlatform === 'all' ? '' : (filterPlatform === 'codechef' ? " AND c.platform = 'CodeChef'" : " AND c.platform = 'LeetCode'");

  try {
    let sql = '';
    let params = [];
    const productionFilter = `
      AND COALESCE(c.is_test, 0) = 0
      AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
      AND c.slug NOT LIKE 'mock-%' AND c.slug NOT LIKE '%mock-%'
      AND c.slug NOT LIKE 'dummy-%' AND c.slug NOT LIKE '%dummy-%'
      AND c.slug NOT LIKE 'retry-%' AND c.slug NOT LIKE 'stale-%'
      AND c.slug NOT LIKE 'crashed-%' AND c.slug NOT LIKE 'regression-%'
      AND c.slug NOT LIKE 'internal-%' AND c.slug NOT LIKE 'debug-%'
      AND c.slug NOT LIKE 'demo-%'`;

    if (batch) {
      // Fix 9: Use AttendanceRecords as the canonical source instead of ParticipationLogs/Registrations.
      // AR rows have attendance_status IN ('PRESENT','ABSENT') for all eligible students.
      sql = `
        SELECT c.title as name, c.slug as contest_slug, c.contest_status, c.start_time as date, c.duration, c.platform,
               (SELECT COUNT(*) FROM Users WHERE status = 'active' AND academic_batch = ?) as total_students,
               (
                 SELECT COUNT(DISTINCT ar.user_id) FROM AttendanceRecords ar
                 JOIN Users u ON ar.user_id = u.id
                 WHERE ar.contest_id = c.contest_id AND ar.attendance_status = 'PRESENT'
                   AND u.academic_batch = ? AND u.status = 'active'
                   AND c.start_time >= u.academic_start_date AND c.start_time <= u.academic_end_date
               ) as present_count,
               (
                 SELECT COUNT(DISTINCT ar.user_id) FROM AttendanceRecords ar
                 JOIN Users u ON ar.user_id = u.id
                 WHERE ar.contest_id = c.contest_id AND ar.attendance_status = 'ABSENT'
                   AND u.academic_batch = ? AND u.status = 'active'
                   AND c.start_time >= u.academic_start_date AND c.start_time <= u.academic_end_date
               ) as absent_count,
               0 as not_applicable_count,
               CASE
                 WHEN c.start_time <= NOW() AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND > NOW() THEN 0
                 WHEN c.contest_status = 'Unrated' THEN 0
                 ELSE IFNULL(ROUND(
                   (
                     SELECT COUNT(DISTINCT ar.user_id) FROM AttendanceRecords ar
                     JOIN Users u ON ar.user_id = u.id
                     WHERE ar.contest_id = c.contest_id AND ar.attendance_status = 'PRESENT'
                       AND u.academic_batch = ? AND u.status = 'active'
                       AND c.start_time >= u.academic_start_date AND c.start_time <= u.academic_end_date
                   ) /
                   NULLIF((
                     SELECT COUNT(DISTINCT ar.user_id) FROM AttendanceRecords ar
                     JOIN Users u ON ar.user_id = u.id
                     WHERE ar.contest_id = c.contest_id AND ar.attendance_status IN ('PRESENT','ABSENT')
                       AND u.academic_batch = ? AND u.status = 'active'
                       AND c.start_time >= u.academic_start_date AND c.start_time <= u.academic_end_date
                   ), 0) * 100
                 ), 100)
               END as attendance_percentage
        FROM Contests c
        WHERE 1=1 ${platformFilterStr} ${productionFilter}
        ORDER BY c.start_time DESC
      `;
      params = [batch, batch, batch, batch, batch];
    } else {
      sql = `
        SELECT c.title as name, c.slug as contest_slug, c.contest_status, c.start_time as date, c.duration, c.platform,
               (SELECT COUNT(*) FROM Users WHERE status = 'active') as total_students,
               (
                 SELECT COUNT(DISTINCT ar.user_id) FROM AttendanceRecords ar
                 JOIN Users u ON ar.user_id = u.id
                 WHERE ar.contest_id = c.contest_id AND ar.attendance_status = 'PRESENT'
                   AND u.status = 'active'
                   AND c.start_time >= u.academic_start_date AND c.start_time <= u.academic_end_date
               ) as present_count,
               (
                 SELECT COUNT(DISTINCT ar.user_id) FROM AttendanceRecords ar
                 JOIN Users u ON ar.user_id = u.id
                 WHERE ar.contest_id = c.contest_id AND ar.attendance_status = 'ABSENT'
                   AND u.status = 'active'
                   AND c.start_time >= u.academic_start_date AND c.start_time <= u.academic_end_date
               ) as absent_count,
               0 as not_applicable_count,
               CASE
                 WHEN c.start_time <= NOW() AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND > NOW() THEN 0
                 WHEN c.contest_status = 'Unrated' THEN 0
                 ELSE IFNULL(ROUND(
                   (
                     SELECT COUNT(DISTINCT ar.user_id) FROM AttendanceRecords ar
                     JOIN Users u ON ar.user_id = u.id
                     WHERE ar.contest_id = c.contest_id AND ar.attendance_status = 'PRESENT'
                       AND u.status = 'active'
                       AND c.start_time >= u.academic_start_date AND c.start_time <= u.academic_end_date
                   ) /
                   NULLIF((
                     SELECT COUNT(DISTINCT ar.user_id) FROM AttendanceRecords ar
                     JOIN Users u ON ar.user_id = u.id
                     WHERE ar.contest_id = c.contest_id AND ar.attendance_status IN ('PRESENT','ABSENT')
                       AND u.status = 'active'
                       AND c.start_time >= u.academic_start_date AND c.start_time <= u.academic_end_date
                   ), 0) * 100
                 ), 100)
               END as attendance_percentage
        FROM Contests c
        WHERE 1=1 ${platformFilterStr} ${productionFilter}
        ORDER BY c.start_time DESC
      `;
    }

    const report = await db.query(sql, params);

    const formatted = report.map(r => ({
      ...r,
      type: r.name.toLowerCase().includes('biweekly') ? 'biweekly' : 'weekly',
      platform: r.platform || 'LeetCode'
    }));

    return res.json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error generating contests report:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
}

// 3. Get Student-wise Summary Report
async function getStudentsReport(req, res) {
  const { department, section, academicBatch, academicYear, startDate, endDate, platform } = req.query;
  const batch = academicBatch || academicYear;
  const filterPlatform = platform ? platform.toLowerCase() : 'all';
  const isCodeChef = filterPlatform === 'codechef';
  const profileTable = isCodeChef ? 'CodeChefProfiles' : 'LeetCodeProfiles';
  const platformFilterStr = filterPlatform === 'all' ? '' : (isCodeChef ? " AND c.platform = 'CodeChef'" : " AND c.platform = 'LeetCode'");
  
  let sql = `
    SELECT u.id, u.roll_no as register_number, u.name, u.department, u.section, u.academic_batch as academic_year, u.leetcode_username, u.codechef_username,
           (SELECT COUNT(*) FROM Registrations r JOIN Contests c ON r.contest_id = c.contest_id WHERE r.user_id = u.id ${platformFilterStr}) as total_contests,
           (SELECT COUNT(*) FROM Registrations r JOIN Contests c ON r.contest_id = c.contest_id 
            WHERE r.user_id = u.id AND c.contest_status = 'Rated' ${platformFilterStr} AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND <= NOW()) as rated_contests,
           (SELECT COUNT(*) FROM Registrations r JOIN Contests c ON r.contest_id = c.contest_id 
            WHERE r.user_id = u.id AND c.contest_status = 'Unrated' ${platformFilterStr}) as unrated_contests,
           (SELECT COUNT(*) FROM ParticipationLogs p JOIN Contests c ON p.contest_id = c.contest_id 
            WHERE p.user_id = u.id AND c.contest_status = 'Rated' ${platformFilterStr} AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND <= NOW()) as present_count,
           (SELECT COUNT(*) FROM Registrations r JOIN Contests c ON r.contest_id = c.contest_id 
            WHERE r.user_id = u.id AND c.contest_status = 'Rated' ${platformFilterStr} AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND <= NOW()) -
           (SELECT COUNT(*) FROM ParticipationLogs p JOIN Contests c ON p.contest_id = c.contest_id 
            WHERE p.user_id = u.id AND c.contest_status = 'Rated' ${platformFilterStr} AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND <= NOW()) as absent_count,
           ROUND(IFNULL(
             (SELECT COUNT(*) FROM ParticipationLogs p JOIN Contests c ON p.contest_id = c.contest_id 
              WHERE p.user_id = u.id AND c.contest_status = 'Rated' ${platformFilterStr} AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND <= NOW()) /
             NULLIF(
               (SELECT COUNT(*) FROM Registrations r JOIN Contests c ON r.contest_id = c.contest_id 
                WHERE r.user_id = u.id AND c.contest_status = 'Rated' ${platformFilterStr} AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND <= NOW()), 0
             ) * 100, 100
           )) as attendance_percentage,
           ROUND(IFNULL(lp.current_rating, 1500)) as current_rating,
           ROUND(IFNULL(lp.highest_rating, 1500)) as best_rating,
           IFNULL(
             (
               SELECT GROUP_CONCAT(
                 CASE 
                   WHEN c.start_time <= NOW() AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND > NOW() THEN 'Ongoing'
                   WHEN c.contest_status = 'Unrated' THEN 'Unrated'
                   WHEN ar.attendance_status = 'PRESENT' THEN 'Present'
                   ELSE 'Absent'
                 END 
                 ORDER BY c.start_time DESC
               )
               FROM AttendanceRecords ar
               JOIN Contests c ON ar.contest_id = c.contest_id
               WHERE ar.user_id = u.id ${platformFilterStr}
             ),
             'No History'
           ) as rank_history
    FROM Users u
    LEFT JOIN ${profileTable} lp ON u.id = lp.user_id
    WHERE u.status = 'active'
  `;
  const params = [];

  if (department) {
    sql += ' AND u.department = ?';
    params.push(department);
  }
  if (section) {
    sql += ' AND u.section = ?';
    params.push(section);
  }
  if (batch) {
    sql += ' AND u.academic_batch = ?';
    params.push(batch);
  }
  if (startDate) {
    sql += ' AND u.academic_start_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    sql += ' AND u.academic_end_date <= ?';
    params.push(endDate);
  }

  sql += ' ORDER BY u.roll_no ASC';

  try {
    const report = await db.query(sql, params);
    return res.json({ success: true, data: report });
  } catch (error) {
    console.error('Error generating students report:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
}

// 4. Department-wise Comparison
async function getDepartmentReport(req, res) {
  const { platform } = req.query;
  const filterPlatform = platform ? platform.toLowerCase() : 'all';
  const platformFilterStr = filterPlatform === 'all' ? '' : (filterPlatform === 'codechef' ? " AND c.platform = 'CodeChef'" : " AND c.platform = 'LeetCode'");

  const cacheKey = `report:department:${filterPlatform}`;
  try {
    const data = await cache.getOrCompute(cacheKey, async () => {
      // Fix 8: Replaced the broken Cartesian JOIN (Registrations × ParticipationLogs) with a clean
      // AttendanceRecords-based aggregation. AR is the canonical attendance source.
      const productionSlugs = `
        AND COALESCE(c.is_test, 0) = 0
        AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
        AND c.slug NOT LIKE 'mock-%' AND c.slug NOT LIKE '%mock-%'
        AND c.slug NOT LIKE 'dummy-%' AND c.slug NOT LIKE '%dummy-%'
        AND c.slug NOT LIKE 'retry-%' AND c.slug NOT LIKE 'stale-%'
        AND c.slug NOT LIKE 'crashed-%' AND c.slug NOT LIKE 'regression-%'
        AND c.slug NOT LIKE 'internal-%' AND c.slug NOT LIKE 'debug-%'
        AND c.slug NOT LIKE 'demo-%'`;
      return await db.query(
        `SELECT u.department,
                COUNT(DISTINCT u.id) as total_students,
                COUNT(DISTINCT CASE WHEN ar.attendance_status IN ('PRESENT','ABSENT') THEN CONCAT(ar.user_id,'-',ar.contest_id) END) as total_records,
                COUNT(DISTINCT CASE WHEN ar.attendance_status = 'PRESENT' THEN CONCAT(ar.user_id,'-',ar.contest_id) END) as present_count,
                IFNULL(ROUND(
                  COUNT(DISTINCT CASE WHEN ar.attendance_status = 'PRESENT' THEN CONCAT(ar.user_id,'-',ar.contest_id) END) /
                  NULLIF(COUNT(DISTINCT CASE WHEN ar.attendance_status IN ('PRESENT','ABSENT') THEN CONCAT(ar.user_id,'-',ar.contest_id) END), 0) * 100
                ), 100) as attendance_percentage
         FROM Users u
         LEFT JOIN AttendanceRecords ar ON ar.user_id = u.id
         LEFT JOIN Contests c ON ar.contest_id = c.contest_id
           AND c.contest_status = 'Rated'
           AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND <= NOW()
           AND c.start_time >= u.academic_start_date
           AND c.start_time <= u.academic_end_date
           ${platformFilterStr.replace(/AND c\./g, 'AND c.')}
           ${productionSlugs}
         WHERE u.status = 'active'
         GROUP BY u.department
         ORDER BY attendance_percentage DESC`
      );
    }, 15 * 60 * 1000);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error generating department report:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
}

// 5. Section-wise Comparison
async function getSectionReport(req, res) {
  const { platform } = req.query;
  const filterPlatform = platform ? platform.toLowerCase() : 'all';
  const platformFilterStr = filterPlatform === 'all' ? '' : (filterPlatform === 'codechef' ? " AND c.platform = 'CodeChef'" : " AND c.platform = 'LeetCode'");

  const cacheKey = `report:section:${filterPlatform}`;
  try {
    const data = await cache.getOrCompute(cacheKey, async () => {
      // Fix 8: Same fix as getDepartmentReport — eliminate Cartesian JOIN, use AttendanceRecords.
      const productionSlugs = `
        AND COALESCE(c.is_test, 0) = 0
        AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
        AND c.slug NOT LIKE 'mock-%' AND c.slug NOT LIKE '%mock-%'
        AND c.slug NOT LIKE 'dummy-%' AND c.slug NOT LIKE '%dummy-%'
        AND c.slug NOT LIKE 'retry-%' AND c.slug NOT LIKE 'stale-%'
        AND c.slug NOT LIKE 'crashed-%' AND c.slug NOT LIKE 'regression-%'
        AND c.slug NOT LIKE 'internal-%' AND c.slug NOT LIKE 'debug-%'
        AND c.slug NOT LIKE 'demo-%'`;
      return await db.query(
        `SELECT u.department, u.section,
                COUNT(DISTINCT u.id) as total_students,
                COUNT(DISTINCT CASE WHEN ar.attendance_status IN ('PRESENT','ABSENT') THEN CONCAT(ar.user_id,'-',ar.contest_id) END) as total_records,
                COUNT(DISTINCT CASE WHEN ar.attendance_status = 'PRESENT' THEN CONCAT(ar.user_id,'-',ar.contest_id) END) as present_count,
                IFNULL(ROUND(
                  COUNT(DISTINCT CASE WHEN ar.attendance_status = 'PRESENT' THEN CONCAT(ar.user_id,'-',ar.contest_id) END) /
                  NULLIF(COUNT(DISTINCT CASE WHEN ar.attendance_status IN ('PRESENT','ABSENT') THEN CONCAT(ar.user_id,'-',ar.contest_id) END), 0) * 100
                ), 100) as attendance_percentage
         FROM Users u
         LEFT JOIN AttendanceRecords ar ON ar.user_id = u.id
         LEFT JOIN Contests c ON ar.contest_id = c.contest_id
           AND c.contest_status = 'Rated'
           AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND <= NOW()
           AND c.start_time >= u.academic_start_date
           AND c.start_time <= u.academic_end_date
           ${platformFilterStr.replace(/AND c\./g, 'AND c.')}
           ${productionSlugs}
         WHERE u.status = 'active'
         GROUP BY u.department, u.section
         ORDER BY u.department ASC, u.section ASC`
      );
    }, 15 * 60 * 1000);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error generating section report:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
}

// 6. Heatmap Data (matrix of Student presence across recent 8 contests)
async function getAttendanceHeatmap(req, res) {
  const { platform } = req.query;
  const filterPlatform = platform ? platform.toLowerCase() : 'all';

  try {
    // Get recent 8 contests overall
    let contestSql = `SELECT contest_id, title as name, start_time as date, contest_status, duration, platform
       FROM Contests `;
    const contestParams = [];
    if (filterPlatform !== 'all') {
      contestSql += ` WHERE platform = ? `;
      contestParams.push(filterPlatform === 'codechef' ? 'CodeChef' : 'LeetCode');
    }
    contestSql += ` ORDER BY start_time DESC LIMIT 8 `;

    const recentContests = await db.query(contestSql, contestParams);
    // Reverse to chronological
    recentContests.reverse();

    if (recentContests.length === 0) {
      return res.json({ success: true, contests: [], students: [] });
    }

    const contestIds = recentContests.map(c => c.contest_id);
    const placeHolders = contestIds.map(() => '?').join(',');

    // Get active students' attendance for these contests
    const rawHeatmap = await db.query(
      `SELECT u.id as student_id, u.name, u.roll_no as register_number, u.leetcode_username, u.codechef_username,
              u.academic_start_date, u.academic_end_date,
              ar.contest_id, ar.attendance_status
       FROM Users u
       LEFT JOIN AttendanceRecords ar ON u.id = ar.user_id AND ar.contest_id IN (${placeHolders})
       WHERE u.status = 'active'
       ORDER BY u.roll_no ASC`,
      contestIds
    );

    const contestDatesMap = new Map();
    recentContests.forEach(c => {
      contestDatesMap.set(c.contest_id, new Date(c.date));
    });

    // Format matrix: Group by student
    const studentHeatmapMap = new Map();
    rawHeatmap.forEach(row => {
      if (!studentHeatmapMap.has(row.student_id)) {
        studentHeatmapMap.set(row.student_id, {
          studentId: row.student_id,
          name: row.name,
          registerNumber: row.register_number,
          leetcodeUsername: row.leetcode_username,
          codechefUsername: row.codechef_username,
          academic_start_date: row.academic_start_date,
          academic_end_date: row.academic_end_date,
          attendance: {} // contestId -> status
        });
      }
      if (row.contest_id) {
        studentHeatmapMap.get(row.student_id).attendance[row.contest_id] = row.attendance_status === 'PRESENT' ? 'present' : 'absent';
      }
    });

    const studentsData = Array.from(studentHeatmapMap.values()).map(student => {
      const start = parseDateOnly(student.academic_start_date);
      const end = parseDateOnly(student.academic_end_date);
      end.setHours(23, 59, 59, 999);

      const timeline = contestIds.map(cid => {
        const cDateRaw = contestDatesMap.get(cid);
        const cDate = parseDateOnly(cDateRaw);
        const isEligible = cDate && cDate >= start && cDate <= end;
        
        const contestInfo = recentContests.find(c => c.contest_id === cid);
        const startTime = new Date(cDateRaw);
        const durationMs = (contestInfo?.duration || 5400) * 1000;
        const endTime = new Date(startTime.getTime() + durationMs);
        const isOngoing = startTime <= new Date() && endTime > new Date();
        const isUnrated = contestInfo?.contest_status === 'Unrated';
        
        if (!isEligible) {
          return 'not_applicable';
        }
        if (isOngoing) {
          return 'ongoing';
        }
        if (isUnrated) {
          return 'unrated';
        }
        return student.attendance[cid] || 'absent';
      });

      return {
        studentId: student.studentId,
        name: student.name,
        registerNumber: student.registerNumber,
        leetcodeUsername: student.leetcodeUsername,
        codechefUsername: student.codechefUsername,
        timeline
      };
    });

    // Format contests list to include a mock id
    const contestsList = recentContests.map((c, idx) => ({
      id: c.contest_id,
      name: c.name,
      date: c.date,
      platform: c.platform || 'LeetCode'
    }));

    return res.json({
      success: true,
      contests: contestsList,
      students: studentsData
    });
  } catch (error) {
    console.error('Error generating heatmap:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate heatmap data' });
  }
}

// 7. Get Detailed Attendance Log (Student-Contest records)
async function getAttendanceLog(req, res) {
  const { platform } = req.query;
  const filterPlatform = platform ? platform.toLowerCase() : 'all';

  try {
    let sql = `SELECT u.roll_no as register_number, u.name as student_name, u.department, u.section,
              c.title as contest_name, c.start_time as contest_date, c.contest_status, c.platform,
              CASE 
                WHEN c.start_time >= u.academic_start_date AND c.start_time <= u.academic_end_date THEN
                  CASE
                    WHEN c.start_time <= NOW() AND c.start_time + INTERVAL IFNULL(c.duration, 5400) SECOND > NOW() THEN 'ONGOING'
                    WHEN c.contest_status = 'Unrated' THEN 'UNRATED'
                    ELSE ar.attendance_status
                  END
                ELSE 'NOT_APPLICABLE'
              END as attendance_status
       FROM AttendanceRecords ar
       JOIN Users u ON ar.user_id = u.id
       JOIN Contests c ON ar.contest_id = c.contest_id
       WHERE u.status = 'active'
    `;
    const params = [];
    if (filterPlatform !== 'all') {
      sql += ` AND c.platform = ? `;
      params.push(filterPlatform === 'codechef' ? 'CodeChef' : 'LeetCode');
    }
    sql += ` ORDER BY c.start_time DESC, u.roll_no ASC `;

    const log = await db.query(sql, params);
    return res.json({ success: true, data: log });
  } catch (error) {
    console.error('Error generating attendance log report:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate attendance log report' });
  }
}

module.exports = {
  getDashboardStats,
  getContestsReport,
  getStudentsReport,
  getDepartmentReport,
  getSectionReport,
  getAttendanceHeatmap,
  getAttendanceLog
};
