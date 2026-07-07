/**
 * NotificationService
 * ===================
 * Generates and manages faculty notifications.
 * Creates actionable insights: low attendance alerts, top performers, sync status.
 */

const db = require('../config/db');

const SEVERITY = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL'
};

const NOTIFICATION_TYPE = {
  MISSED_CONTEST: 'missed_contest',
  LOW_ATTENDANCE: 'low_attendance',
  NEW_CONTEST: 'new_contest',
  TOP_PERFORMER: 'top_performer',
  SYNC_COMPLETE: 'sync_complete',
  SYNC_FAILED: 'sync_failed',
  PLATFORM_DOWN: 'platform_down',
  SYSTEM: 'system'
};

/**
 * Ensure the notifications table has the severity and archived columns.
 * This is done as a runtime check (idempotent) without ALTER TABLE on every startup.
 */
let notificationsEnhanced = null;
async function ensureNotificationsEnhanced() {
  if (notificationsEnhanced === true) return;
  try {
    const cols = await db.query("SHOW COLUMNS FROM notifications");
    const colNames = cols.map(c => c.Field.toLowerCase());

    if (!colNames.includes('severity')) {
      await db.query("ALTER TABLE notifications ADD COLUMN severity ENUM('INFO','WARNING','CRITICAL') DEFAULT 'INFO' AFTER type");
      console.log('[NotificationService] Added severity column to notifications.');
    }
    if (!colNames.includes('archived')) {
      await db.query("ALTER TABLE notifications ADD COLUMN archived BOOLEAN DEFAULT FALSE AFTER is_read");
      console.log('[NotificationService] Added archived column to notifications.');
    }
    if (!colNames.includes('contest_id')) {
      await db.query("ALTER TABLE notifications ADD COLUMN contest_id INT DEFAULT NULL AFTER student_id");
      console.log('[NotificationService] Added contest_id column to notifications.');
    }
    notificationsEnhanced = true;
  } catch (err) {
    console.warn('[NotificationService] Could not enhance notifications table:', err.message);
    notificationsEnhanced = false;
  }
}

/**
 * Create a notification.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} opts.type - One of NOTIFICATION_TYPE values
 * @param {string} opts.severity - One of SEVERITY values
 * @param {number|null} opts.studentId
 * @param {number|null} opts.contestId
 */
async function createNotification({ title, message, type = NOTIFICATION_TYPE.SYSTEM, severity = SEVERITY.INFO, studentId = null, contestId = null }) {
  try {
    await ensureNotificationsEnhanced();
    await db.query(
      `INSERT INTO notifications (title, message, type, severity, student_id, contest_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, message, type, severity, studentId, contestId]
    );
  } catch (err) {
    console.error('[NotificationService] Failed to create notification:', err.message);
  }
}

/**
 * Generate low-attendance alerts for all students below a threshold.
 * @param {number} threshold - Attendance percentage threshold (default 50%)
 */
async function generateLowAttendanceAlerts(threshold = 50) {
  try {
    const students = await db.query(
      `SELECT u.id, u.name, u.roll_no,
              (SELECT COUNT(*) FROM Registrations r JOIN Contests c ON r.contest_id = c.contest_id
               WHERE r.user_id = u.id AND c.contest_status = 'Rated'
                 AND c.start_time + INTERVAL IFNULL(c.duration,5400) SECOND <= NOW()) as total,
              (SELECT COUNT(*) FROM ParticipationLogs p JOIN Contests c ON p.contest_id = c.contest_id
               WHERE p.user_id = u.id AND c.contest_status = 'Rated'
                 AND c.start_time + INTERVAL IFNULL(c.duration,5400) SECOND <= NOW()) as attended
       FROM Users u
       WHERE u.status = 'active'`
    );

    let alertCount = 0;
    for (const s of students) {
      const total = Number(s.total || 0);
      const attended = Number(s.attended || 0);
      if (total < 3) continue; // Not enough data
      const pct = total > 0 ? Math.round((attended / total) * 100) : 0;
      if (pct <= threshold) {
        await createNotification({
          title: 'Low Attendance Alert',
          message: `${s.name} (${s.roll_no}) has only ${pct}% attendance (${attended}/${total} contests).`,
          type: NOTIFICATION_TYPE.LOW_ATTENDANCE,
          severity: pct <= 30 ? SEVERITY.CRITICAL : SEVERITY.WARNING,
          studentId: s.id
        });
        alertCount++;
      }
    }
    console.log(`[NotificationService] Generated ${alertCount} low-attendance alerts (threshold: ${threshold}%).`);
    return alertCount;
  } catch (err) {
    console.error('[NotificationService] Failed to generate low-attendance alerts:', err.message);
    return 0;
  }
}

/**
 * Notify that a sync completed successfully.
 * @param {object} stats - { contestsSynced, studentsProcessed, duration }
 */
async function notifySyncComplete(stats) {
  await createNotification({
    title: 'Synchronization Completed',
    message: `Platform sync completed. Contests processed: ${stats.contestsSynced || 0}, Students: ${stats.studentsProcessed || 0}. Duration: ${stats.duration || 'N/A'}.`,
    type: NOTIFICATION_TYPE.SYNC_COMPLETE,
    severity: SEVERITY.INFO
  });
}

/**
 * Notify that a sync failed.
 * @param {string} error - Error message
 */
async function notifySyncFailed(error) {
  await createNotification({
    title: 'Synchronization Failed',
    message: `Platform sync encountered an error: ${error}`,
    type: NOTIFICATION_TYPE.SYNC_FAILED,
    severity: SEVERITY.CRITICAL
  });
}

/**
 * Notify that a platform API is down or degraded.
 * @param {string} platform
 * @param {string} status - 'down' | 'degraded'
 */
async function notifyPlatformHealth(platform, status) {
  await createNotification({
    title: `${platform.charAt(0).toUpperCase() + platform.slice(1)} Platform ${status === 'down' ? 'Unavailable' : 'Degraded'}`,
    message: `The ${platform} API is currently ${status}. Some student profiles may not have been updated.`,
    type: NOTIFICATION_TYPE.PLATFORM_DOWN,
    severity: status === 'down' ? SEVERITY.CRITICAL : SEVERITY.WARNING
  });
}

/**
 * Get notifications with optional filters.
 * @param {object} filters - { severity?, type?, search?, limit?, unreadOnly?, archived? }
 */
async function getNotifications({ severity, type, search, limit = 50, unreadOnly = false, archived = false } = {}) {
  try {
    await ensureNotificationsEnhanced();
    let sql = `
      SELECT n.*, u.name as student_name, u.roll_no as student_roll, c.title as contest_name
      FROM notifications n
      LEFT JOIN Users u ON n.student_id = u.id
      LEFT JOIN Contests c ON n.contest_id = c.contest_id
      WHERE 1=1
    `;
    const params = [];

    if (unreadOnly) { sql += ' AND n.is_read = FALSE'; }
    if (!archived) { sql += ' AND (n.archived = FALSE OR n.archived IS NULL)'; }
    else { sql += ' AND n.archived = TRUE'; }
    if (severity) { sql += ' AND n.severity = ?'; params.push(severity); }
    if (type) { sql += ' AND n.type = ?'; params.push(type); }
    if (search) {
      sql += ' AND (n.title LIKE ? OR n.message LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const safeLimit = Number.parseInt(limit, 10) || 50;
    if (!Number.isInteger(safeLimit) || safeLimit <= 0) {
      throw new Error("Invalid limit");
    }

    sql += ` ORDER BY n.is_read ASC, n.created_at DESC LIMIT ${safeLimit}`;

    return await db.query(sql, params);
  } catch (err) {
    console.error('[NotificationService] Failed to fetch notifications:', err.message);
    return [];
  }
}

/**
 * Mark a notification as read.
 */
async function markRead(id) {
  await db.query('UPDATE notifications SET is_read = TRUE WHERE id = ?', [id]);
}

/**
 * Mark all notifications as read.
 */
async function markAllRead() {
  await db.query('UPDATE notifications SET is_read = TRUE');
}

/**
 * Archive a notification.
 */
async function archive(id) {
  try {
    await ensureNotificationsEnhanced();
    await db.query('UPDATE notifications SET archived = TRUE WHERE id = ?', [id]);
  } catch (err) {
    console.error('[NotificationService] Failed to archive notification:', err.message);
  }
}

/**
 * Get unread notification count.
 */
async function getUnreadCount() {
  try {
    await ensureNotificationsEnhanced();
    const [row] = await db.query('SELECT COUNT(*) as count FROM notifications WHERE is_read = FALSE AND (archived = FALSE OR archived IS NULL)');
    return row ? Number(row.count) : 0;
  } catch (err) {
    return 0;
  }
}

/**
 * Generate alerts for students missing coding profile handles.
 */
async function generateMissingHandleAlerts() {
  try {
    const students = await db.query(
      `SELECT id, name, roll_no FROM Users 
       WHERE status = 'active' 
         AND (leetcode_username IS NULL OR leetcode_username = ''
              OR codechef_username IS NULL OR codechef_username = ''
              OR codeforces_username IS NULL OR codeforces_username = '')`
    );
    for (const s of students) {
      await createNotification({
        title: 'Missing Coding Profile Handle',
        message: `${s.name} (${s.roll_no}) is missing one or more coding profile handles (LeetCode, CodeChef, or Codeforces).`,
        type: NOTIFICATION_TYPE.SYSTEM,
        severity: SEVERITY.WARNING,
        studentId: s.id
      });
    }
    console.log(`[NotificationService] Generated missing handle warnings for ${students.length} students.`);
  } catch (err) {
    console.error('[NotificationService] Failed to generate missing handle alerts:', err.message);
  }
}

/**
 * Check if rating change is significant (+/- 50 points) and notify.
 */
async function checkAndNotifyRatingChange(studentId, studentName, platform, oldRating, newRating) {
  if (!oldRating || !newRating) return;
  const diff = newRating - oldRating;
  if (diff >= 50) {
    await createNotification({
      title: 'Significant Rating Improvement',
      message: `${studentName} gained +${diff} points on ${platform}! New Rating: ${newRating}.`,
      type: NOTIFICATION_TYPE.TOP_PERFORMER,
      severity: SEVERITY.INFO,
      studentId
    });
  } else if (diff <= -50) {
    await createNotification({
      title: 'Significant Rating Drop',
      message: `${studentName} dropped ${diff} points on ${platform}. New Rating: ${newRating}.`,
      type: NOTIFICATION_TYPE.SYSTEM,
      severity: SEVERITY.WARNING,
      studentId
    });
  }
}

/**
 * Generate alerts for contests starting in the next 24 hours.
 */
async function generateUpcomingContestAlerts() {
  try {
    const contests = await db.query(
      `SELECT contest_id, title, start_time FROM Contests 
       WHERE start_time BETWEEN NOW() AND NOW() + INTERVAL 24 HOUR`
    );
    for (const c of contests) {
      await createNotification({
        title: 'Upcoming Contest Alert',
        message: `Contest "${c.title}" is starting within 24 hours at ${new Date(c.start_time).toLocaleString()}.`,
        type: NOTIFICATION_TYPE.NEW_CONTEST,
        severity: SEVERITY.INFO,
        contestId: c.contest_id
      });
    }
    console.log(`[NotificationService] Generated upcoming contest alerts for ${contests.length} contests.`);
  } catch (err) {
    console.error('[NotificationService] Failed to generate upcoming contest alerts:', err.message);
  }
}

module.exports = {
  createNotification,
  generateLowAttendanceAlerts,
  notifySyncComplete,
  notifySyncFailed,
  notifyPlatformHealth,
  getNotifications,
  markRead,
  markAllRead,
  archive,
  getUnreadCount,
  generateMissingHandleAlerts,
  checkAndNotifyRatingChange,
  generateUpcomingContestAlerts,
  SEVERITY,
  NOTIFICATION_TYPE
};
