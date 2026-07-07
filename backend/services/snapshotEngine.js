const db = require('../config/db');
const EventBus = require('./EventBus');

/**
 * Difference engine and aggregate snapshot manager (Singleton).
 * Reduces DB overhead and SSE message sizes by tracking differential updates.
 */
class SnapshotEngine {
  constructor() {
    this.previousSnapshots = {}; // contestId -> map of studentId -> stats
  }

  /**
   * Loads the current database records for a contest as the "previous snapshot".
   * @param {number} contestId - The DB contest ID.
   */
  async loadSnapshot(contestId) {
    const rows = await db.query(
      `SELECT studentId, attendanceStatus, \`rank\`, solved, score, penalty, ratingBefore, ratingAfter, ratingChange, verified, syncPass 
       FROM ContestAttendance 
       WHERE contestId = ?`,
      [contestId]
    );

    const snapshot = {};
    for (const r of rows) {
      snapshot[r.studentId] = {
        attendanceStatus: r.attendanceStatus,
        rank: r.rank,
        solved: r.solved,
        score: parseFloat(r.score || 0),
        penalty: r.penalty,
        ratingBefore: r.ratingBefore ? parseFloat(r.ratingBefore) : null,
        ratingAfter: r.ratingAfter ? parseFloat(r.ratingAfter) : null,
        ratingChange: r.ratingChange ? parseFloat(r.ratingChange) : null,
        verified: r.verified || 0,
        syncPass: r.syncPass || 0
      };
    }
    this.previousSnapshots[contestId] = snapshot;
    console.log(`[SnapshotEngine] Loaded previous database snapshot for contest ID ${contestId}. Records: ${rows.length}`);
  }

  /**
   * Evaluates updates, applies differential DB writes, and broadcasts SSE updates.
   * @param {number} contestId - Database ID of the contest.
   * @param {number} studentId - Database ID of the student.
   * @param {string} username - Platform username.
   * @param {object} newStats - Newly fetchedCP statistics.
   */
  async compareAndUpdate(contestId, studentId, username, newStats) {
    const prev = this.previousSnapshots[contestId] || {};
    const old = prev[studentId];

    const updatedStats = {
      attendanceStatus: newStats.attendanceStatus || 'Unknown',
      rank: newStats.rank !== undefined && newStats.rank !== null ? parseInt(newStats.rank, 10) : null,
      solved: newStats.solved !== undefined ? parseInt(newStats.solved, 10) : 0,
      score: newStats.score !== undefined ? parseFloat(newStats.score) : 0.00,
      penalty: newStats.penalty !== undefined ? parseInt(newStats.penalty, 10) : 0,
      ratingBefore: newStats.ratingBefore !== undefined && newStats.ratingBefore !== null ? parseFloat(newStats.ratingBefore) : null,
      ratingAfter: newStats.ratingAfter !== undefined && newStats.ratingAfter !== null ? parseFloat(newStats.ratingAfter) : null,
      ratingChange: newStats.ratingChange !== undefined && newStats.ratingChange !== null ? parseFloat(newStats.ratingChange) : null,
      verified: newStats.verified !== undefined ? parseInt(newStats.verified, 10) : 0,
      syncPass: newStats.syncPass !== undefined ? parseInt(newStats.syncPass, 10) : 0
    };

    let hasChanged = false;
    const diff = {};

    if (!old) {
      hasChanged = true;
      Object.assign(diff, updatedStats);
    } else {
      for (const k of Object.keys(updatedStats)) {
        if (old[k] !== updatedStats[k]) {
          hasChanged = true;
          diff[k] = updatedStats[k];
        }
      }
    }

    if (hasChanged) {
      await db.query(`
        INSERT INTO ContestAttendance (
          contestId, studentId, username, attendanceStatus, \`rank\`, solved, score, penalty, 
          ratingBefore, ratingAfter, ratingChange, verified, syncPass, firstDetectedAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          attendanceStatus = VALUES(attendanceStatus),
          \`rank\` = VALUES(\`rank\`),
          solved = VALUES(solved),
          score = VALUES(score),
          penalty = VALUES(penalty),
          ratingBefore = VALUES(ratingBefore),
          ratingAfter = VALUES(ratingAfter),
          ratingChange = VALUES(ratingChange),
          verified = VALUES(verified),
          syncPass = VALUES(syncPass)
      `, [
        contestId,
        studentId,
        username,
        updatedStats.attendanceStatus,
        updatedStats.rank,
        updatedStats.solved,
        updatedStats.score,
        updatedStats.penalty,
        updatedStats.ratingBefore,
        updatedStats.ratingAfter,
        updatedStats.ratingChange,
        updatedStats.verified,
        updatedStats.syncPass
      ]);

      // Cache updated values locally
      if (!this.previousSnapshots[contestId]) {
        this.previousSnapshots[contestId] = {};
      }
      this.previousSnapshots[contestId][studentId] = updatedStats;

      // Broadcast changes via EventBus
      EventBus.emit('StudentUpdated', {
        contestId,
        studentId,
        username,
        diff,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Generates aggregate metrics and writes to ContestSnapshots.
   * @param {number} contestId - The database ID of the contest.
   */
  async recordContestSnapshot(contestId) {
    const rows = await db.query(
      `SELECT attendanceStatus, \`rank\`, solved, score, ratingChange 
       FROM ContestAttendance 
       WHERE contestId = ?`,
      [contestId]
    );

    const totalStudents = rows.length;
    if (totalStudents === 0) return;

    // Filter active student participants (Participating or Present)
    const participants = rows.filter(r => r.attendanceStatus === 'Participating' || r.attendanceStatus === 'Present');
    const participantsCount = participants.length;
    const attendancePercentage = totalStudents > 0 ? (participantsCount / totalStudents) * 100 : 0.00;

    let averageSolved = 0;
    let averageRank = 0;
    let highestRank = null;
    let averageRankCount = 0;
    let averageSolvedCount = 0;

    for (const p of participants) {
      if (p.solved !== null && p.solved !== undefined) {
        averageSolved += parseFloat(p.solved);
        averageSolvedCount++;
      }
      if (p.rank !== null && p.rank !== undefined) {
        averageRank += parseInt(p.rank, 10);
        averageRankCount++;
        if (highestRank === null || p.rank < highestRank) {
          highestRank = p.rank;
        }
      }
    }

    const finalAvgSolved = averageSolvedCount > 0 ? averageSolved / averageSolvedCount : 0.00;
    const finalAvgRank = averageRankCount > 0 ? averageRank / averageRankCount : 0.00;

    await db.query(`
      INSERT INTO ContestSnapshots (contestId, snapshotTime, participants, attendancePercentage, averageSolved, highestRank, averageRank)
      VALUES (?, NOW(), ?, ?, ?, ?, ?)
    `, [
      contestId,
      participantsCount,
      attendancePercentage,
      finalAvgSolved,
      highestRank,
      finalAvgRank
    ]);

    console.log(`[SnapshotEngine] Recorded ContestSnapshot for contest ID ${contestId}. Attendance %: ${attendancePercentage.toFixed(2)}%`);
    EventBus.emit('SnapshotCreated', { contestId });
  }

  /**
   * Resets the cache for a specific contest slug.
   * @param {number} contestId - The database ID of the contest.
   */
  clearCache(contestId) {
    delete this.previousSnapshots[contestId];
  }
}

// Export singleton instance
module.exports = new SnapshotEngine();
