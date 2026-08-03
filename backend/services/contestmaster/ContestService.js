const db = require('../../config/db');
const { formatBatchToLong } = require('../../utils/batchHelper');

/**
 * ContestService
 * Responsible ONLY for contest metadata, listing, CRUD operations, and dynamic batch options.
 */
class ContestService {
  /**
   * Retrieves available academic batches with active students.
   */
  async getAvailableBatches() {
    const list = await db.query(
      `SELECT DISTINCT u.academic_batch 
       FROM Users u
       WHERE u.status = 'active' 
         AND u.academic_batch IS NOT NULL 
         AND u.academic_batch != ''
       ORDER BY u.academic_batch ASC`
    );
    return [...new Set(list.map(item => formatBatchToLong(item.academic_batch)))];
  }

  /**
   * Fetches paginated contest list with server-side filters.
   */
  async getContests(platform, { type, status, page = 1, limit = 10, search = '' } = {}) {
    const dbPlatformMap = {
      leetcode: 'LeetCode',
      codechef: 'CodeChef',
      codeforces: 'Codeforces'
    };
    const dbPlatform = dbPlatformMap[platform.toLowerCase()] || platform;

    let query = `
      SELECT 
        c.contest_id as id,
        c.contest_id,
        c.title as name,
        c.platform,
        c.contest_type as type,
        c.start_time as date,
        c.duration,
        c.contest_status as status,
        IFNULL(c.source, 'MANUAL') as sync_source,
        IFNULL(c.last_synced_at, 'SYNCHRONIZED') as sync_status,
        (SELECT COUNT(*) FROM Users u WHERE u.status = 'active') as registration_count,
        (SELECT COUNT(DISTINCT ar.user_id) FROM AttendanceRecords ar WHERE ar.contest_id = c.contest_id AND UPPER(ar.attendance_status) = 'PRESENT') as attendance_count
      FROM Contests c
      WHERE c.platform = ?
        AND c.slug NOT LIKE 'test-%'
        AND c.slug NOT LIKE 'mock-%'
        AND c.slug NOT LIKE 'dummy-%'
        AND c.slug NOT LIKE 'crashed-contest-%'
        AND c.slug NOT LIKE 'retry-contest-%'
        AND c.slug NOT LIKE 'stale-contest-%'
        AND c.slug NOT LIKE 'upcoming-live-%'
        AND c.slug NOT LIKE 'starting-%'
        AND c.slug NOT LIKE 'temporary-%'
        AND c.slug NOT LIKE 'placeholder-%'
    `;
    const params = [dbPlatform];

    if (type) {
      query += ` AND LOWER(c.contest_type) = LOWER(?)`;
      params.push(type);
    }

    if (status) {
      query += ` AND LOWER(c.contest_status) = LOWER(?)`;
      params.push(status);
    }

    if (search) {
      query += ` AND (c.title LIKE ? OR c.contest_id LIKE ?)`;
      const searchLike = `%${search}%`;
      params.push(searchLike, searchLike);
    }

    query += ` ORDER BY c.start_time DESC`;

    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as count_tbl`;
    const totalResult = await db.query(countQuery, params);
    const total = totalResult[0]?.total || 0;

    const safeLimit = Math.max(1, parseInt(limit) || 10);
    const safeOffset = Math.max(0, (Math.max(1, parseInt(page) || 1) - 1) * safeLimit);

    query += ` LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const contests = await db.query(query, params);

    return {
      contests,
      pagination: {
        total,
        page: parseInt(page) || 1,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit)
      }
    };
  }

  /**
   * Fetches single contest metadata by ID.
   */
  async getContestById(id) {
    const rows = await db.query(`SELECT * FROM Contests WHERE contest_id = ? OR id = ?`, [id, id]);
    return rows[0] || null;
  }
}

module.exports = new ContestService();
