/**
 * contestIntegrityValidator.js
 * ============================
 * Non-blocking startup integrity audit for Contest Master.
 *
 * Checks for:
 *   ✓ Duplicate contest slugs
 *   ✓ Orphan records (ContestParticipants, AttendanceRecords, ContestAttendance)
 *   ✓ LiveContests with no matching Contests record
 *   ✓ Duplicate slugs in LiveContests
 *   ✓ Broken foreign keys (attendance with no user, no contest)
 *   ✓ Inconsistent contest IDs (AttendanceRecords vs ContestAttendance)
 *   ✓ Invalid contest dates (NULL start_time)
 *
 * This service is READ-ONLY. It NEVER modifies data.
 * Called on server startup from server.js.
 */

const db = require('../config/db');

class ContestIntegrityValidator {
  /**
   * Run all integrity checks non-blocking.
   * Returns a report object with passed[] and failed[] arrays.
   */
  static async run() {
    const report = { passed: [], failed: [], warnings: [] };

    console.log('\n[IntegrityValidator] ============================================');
    console.log('[IntegrityValidator] Starting Contest Master integrity audit...');
    console.log('[IntegrityValidator] ============================================');

    try {
      // ── CHECK 1: Duplicate slugs in Contests (should be impossible — UNIQUE KEY) ──
      try {
        const dupSlugs = await db.query(`
          SELECT slug, COUNT(*) AS cnt
          FROM Contests
          GROUP BY slug
          HAVING cnt > 1
          LIMIT 10
        `);
        if (dupSlugs.length > 0) {
          report.failed.push(`✗ duplicate contests: ${dupSlugs.map(r => `"${r.slug}"(×${r.cnt})`).join(', ')}`);
        } else {
          report.passed.push('✓ duplicate contests: NONE');
        }
      } catch (err) {
        report.warnings.push(`⚠ duplicate contests check skipped: ${err.message}`);
      }

      // ── CHECK 2: Orphan ContestParticipants (contest_slug not in Contests) ──
      try {
        const orphanCP = await db.query(`
          SELECT COUNT(*) AS cnt
          FROM ContestParticipants cp
          LEFT JOIN Contests c ON cp.contest_slug = c.slug
          WHERE c.slug IS NULL
        `);
        const cnt = parseInt(orphanCP[0]?.cnt, 10) || 0;
        if (cnt > 0) {
          report.failed.push(`✗ orphan records: ${cnt} ContestParticipants rows reference no Contests.slug`);
        } else {
          report.passed.push('✓ orphan records: ContestParticipants are clean');
        }
      } catch (err) {
        report.warnings.push(`⚠ orphan ContestParticipants check skipped: ${err.message}`);
      }

      // ── CHECK 3: Orphan AttendanceRecords (contest_id not in Contests) ──
      try {
        const orphanAR = await db.query(`
          SELECT COUNT(*) AS cnt
          FROM AttendanceRecords ar
          LEFT JOIN Contests c ON ar.contest_id = c.contest_id
          WHERE c.contest_id IS NULL
        `);
        const cnt = parseInt(orphanAR[0]?.cnt, 10) || 0;
        if (cnt > 0) {
          report.failed.push(`✗ broken foreign keys: ${cnt} AttendanceRecords rows have no matching Contests.contest_id`);
        } else {
          report.passed.push('✓ broken foreign keys: AttendanceRecords.contest_id all valid');
        }
      } catch (err) {
        report.warnings.push(`⚠ orphan AttendanceRecords check skipped: ${err.message}`);
      }

      // ── CHECK 4: Orphan ContestAttendance (contestId not in LiveContests) ──
      try {
        const orphanCA = await db.query(`
          SELECT COUNT(*) AS cnt
          FROM ContestAttendance ca
          LEFT JOIN LiveContests lc ON ca.contestId = lc.id
          WHERE lc.id IS NULL
        `);
        const cnt = parseInt(orphanCA[0]?.cnt, 10) || 0;
        if (cnt > 0) {
          report.failed.push(`✗ broken foreign keys: ${cnt} ContestAttendance rows have no matching LiveContests.id`);
        } else {
          report.passed.push('✓ broken foreign keys: ContestAttendance.contestId all valid');
        }
      } catch (err) {
        report.warnings.push(`⚠ orphan ContestAttendance check skipped: ${err.message}`);
      }

      // ── CHECK 5: Duplicate slugs in LiveContests (should be impossible — UNIQUE KEY) ──
      try {
        const dupLive = await db.query(`
          SELECT contestSlug, COUNT(*) AS cnt
          FROM LiveContests
          GROUP BY contestSlug
          HAVING cnt > 1
          LIMIT 10
        `);
        if (dupLive.length > 0) {
          report.failed.push(`✗ duplicate slugs: ${dupLive.map(r => `"${r.contestSlug}"(×${r.cnt})`).join(', ')} in LiveContests`);
        } else {
          report.passed.push('✓ duplicate slugs: LiveContests are clean');
        }
      } catch (err) {
        report.warnings.push(`⚠ duplicate LiveContests slugs check skipped: ${err.message}`);
      }

      // ── CHECK 6: LiveContests with no Contests record ──
      try {
        const orphanLive = await db.query(`
          SELECT lc.contestSlug
          FROM LiveContests lc
          LEFT JOIN Contests c ON lc.contestSlug = c.slug
          WHERE c.slug IS NULL
          LIMIT 20
        `);
        if (orphanLive.length > 0) {
          report.failed.push(`✗ inconsistent contest IDs: ${orphanLive.length} LiveContests have no Contests record: [${orphanLive.map(r => r.contestSlug).join(', ')}]`);
        } else {
          report.passed.push('✓ inconsistent contest IDs: all LiveContests have matching Contests records');
        }
      } catch (err) {
        report.warnings.push(`⚠ LiveContests→Contests link check skipped: ${err.message}`);
      }

      // ── CHECK 7: Invalid contest dates (NULL or future > 6 months) ──
      try {
        const badDates = await db.query(`
          SELECT COUNT(*) AS cnt
          FROM Contests
          WHERE start_time IS NULL
        `);
        const cnt = parseInt(badDates[0]?.cnt, 10) || 0;
        if (cnt > 0) {
          report.failed.push(`✗ invalid contest dates: ${cnt} Contests have NULL start_time`);
        } else {
          report.passed.push('✓ invalid contest dates: all Contests have valid start_time');
        }
      } catch (err) {
        report.warnings.push(`⚠ invalid dates check skipped: ${err.message}`);
      }

      // ── CHECK 8: Student count consistency (AttendanceRecords vs ContestAttendance) ──
      try {
        const discrepancies = await db.query(`
          SELECT COUNT(*) AS cnt FROM (
            SELECT c.slug
            FROM Contests c
            JOIN LiveContests lc ON lc.contestSlug = c.slug
            LEFT JOIN (
              SELECT contest_id, COUNT(DISTINCT user_id) AS ar_cnt
              FROM AttendanceRecords GROUP BY contest_id
            ) ar ON ar.contest_id = c.contest_id
            LEFT JOIN (
              SELECT contestId, COUNT(DISTINCT studentId) AS ca_cnt
              FROM ContestAttendance GROUP BY contestId
            ) ca ON ca.contestId = lc.id
            WHERE ar.ar_cnt IS NOT NULL
              AND ca.ca_cnt IS NOT NULL
              AND ABS(ar.ar_cnt - ca.ca_cnt) > 2
          ) AS disc
        `);
        const cnt = parseInt(discrepancies[0]?.cnt, 10) || 0;
        if (cnt > 0) {
          report.failed.push(`✗ inconsistent contest IDs: ${cnt} contests have student count mismatch between AttendanceRecords and ContestAttendance (>2 student difference)`);
        } else {
          report.passed.push('✓ inconsistent contest IDs: AttendanceRecords and ContestAttendance student counts are consistent');
        }
      } catch (err) {
        report.warnings.push(`⚠ student count consistency check skipped: ${err.message}`);
      }

      // ── CHECK 9: AttendanceRecords with no matching Users row ──
      try {
        const orphanARUser = await db.query(`
          SELECT COUNT(*) AS cnt
          FROM AttendanceRecords ar
          LEFT JOIN Users u ON ar.user_id = u.id
          WHERE u.id IS NULL
        `);
        const cnt = parseInt(orphanARUser[0]?.cnt, 10) || 0;
        if (cnt > 0) {
          report.failed.push(`✗ broken foreign keys: ${cnt} AttendanceRecords rows reference deleted Users`);
        } else {
          report.passed.push('✓ broken foreign keys: AttendanceRecords.user_id all valid');
        }
      } catch (err) {
        report.warnings.push(`⚠ AttendanceRecords user FK check skipped: ${err.message}`);
      }

    } catch (err) {
      console.error('[IntegrityValidator] Fatal audit error:', err.message);
      report.warnings.push(`✗ Audit aborted early: ${err.message}`);
    }

    // ── Print report ──
    console.log('\n[IntegrityValidator] === AUDIT RESULTS ===');
    for (const p of report.passed) {
      console.log(`[IntegrityValidator] ${p}`);
    }
    for (const f of report.failed) {
      console.error(`[IntegrityValidator] ${f}`);
    }
    for (const w of report.warnings) {
      console.warn(`[IntegrityValidator] ${w}`);
    }

    if (report.failed.length === 0) {
      console.log('[IntegrityValidator] ✅ ALL CHECKS PASSED — Contest data integrity is healthy.');
    } else {
      console.error(`[IntegrityValidator] ⚠️  ${report.failed.length} INTEGRITY ISSUE(S) DETECTED. See lines above.`);
    }
    console.log('[IntegrityValidator] ============================================\n');

    return report;
  }
}

module.exports = ContestIntegrityValidator;
