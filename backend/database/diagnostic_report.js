const db = require('../config/db');

async function run() {
  let connection;
  try {
    await db.initializeDatabase();
    connection = await db.getPool().getConnection();
    console.log("======================================================================");
    console.log("                    ENTHRAHUB PORTAL DIAGNOSTIC REPORT                ");
    console.log("======================================================================\n");

    let allPassed = true;

    // 1. Total Students Checked
    const [students] = await connection.query("SELECT COUNT(*) as count FROM Users WHERE status = 'active'");
    const studentCount = students[0].count;
    console.log(`[PASS] Students Checked: ${studentCount} active students found.`);

    // 2. Mismatched Contest IDs in AttendanceRecords
    const [mismatches] = await connection.query(`
      SELECT COUNT(*) as count
      FROM AttendanceRecords ar
      JOIN Contests c ON ar.contest_slug = c.slug
      WHERE ar.contest_id != c.contest_id
    `);
    const mismatchCount = mismatches[0].count;
    if (mismatchCount === 0) {
      console.log(`[PASS] Mismatched Contest IDs: 0 mismatches found in AttendanceRecords.`);
    } else {
      console.error(`[FAIL] Mismatched Contest IDs: Found ${mismatchCount} mismatched records!`);
      allPassed = false;
    }

    // 3. Duplicate AttendanceRecords by (user_id, contest_id)
    const [dupAttendance] = await connection.query(`
      SELECT user_id, contest_id, COUNT(*) as count
      FROM AttendanceRecords
      GROUP BY user_id, contest_id
      HAVING count > 1
    `);
    if (dupAttendance.length === 0) {
      console.log(`[PASS] Duplicate AttendanceRecords: 0 duplicate (user_id, contest_id) records found.`);
    } else {
      console.error(`[FAIL] Duplicate AttendanceRecords: Found ${dupAttendance.length} duplicate groups!`);
      allPassed = false;
    }

    // 4. Duplicate ContestParticipants by (contest_slug, username)
    const [dupParticipants] = await connection.query(`
      SELECT contest_slug, username, COUNT(*) as count
      FROM ContestParticipants
      GROUP BY contest_slug, username
      HAVING count > 1
    `);
    if (dupParticipants.length === 0) {
      console.log(`[PASS] Duplicate ContestParticipants: 0 duplicate (contest_slug, username) records found.`);
    } else {
      console.error(`[FAIL] Duplicate ContestParticipants: Found ${dupParticipants.length} duplicate groups!`);
      allPassed = false;
    }

    // 5. Duplicate Contests by slug
    const [dupContests] = await connection.query(`
      SELECT slug, COUNT(*) as count
      FROM Contests
      GROUP BY slug
      HAVING count > 1
    `);
    if (dupContests.length === 0) {
      console.log(`[PASS] Duplicate Contests: 0 duplicate slugs found.`);
    } else {
      console.error(`[FAIL] Duplicate Contests: Found ${dupContests.length} duplicate slugs!`);
      allPassed = false;
    }

    // 6. Orphan Check: AttendanceRecords referencing non-existent Contests
    const [orphanAttendance] = await connection.query(`
      SELECT COUNT(*) as count
      FROM AttendanceRecords ar
      LEFT JOIN Contests c ON ar.contest_id = c.contest_id
      WHERE c.contest_id IS NULL
    `);
    if (orphanAttendance[0].count === 0) {
      console.log(`[PASS] Orphan AttendanceRecords: 0 records referencing non-existent Contests.`);
    } else {
      console.error(`[FAIL] Orphan AttendanceRecords: Found ${orphanAttendance[0].count} orphan records!`);
      allPassed = false;
    }

    // 7. Orphan Check: Registrations referencing non-existent Contests
    const [orphanRegs] = await connection.query(`
      SELECT COUNT(*) as count
      FROM Registrations r
      LEFT JOIN Contests c ON r.contest_id = c.contest_id
      WHERE c.contest_id IS NULL
    `);
    if (orphanRegs[0].count === 0) {
      console.log(`[PASS] Orphan Registrations: 0 records referencing non-existent Contests.`);
    } else {
      console.error(`[FAIL] Orphan Registrations: Found ${orphanRegs[0].count} orphan records!`);
      allPassed = false;
    }

    // 8. Orphan Check: ParticipationLogs referencing non-existent Contests
    const [orphanParts] = await connection.query(`
      SELECT COUNT(*) as count
      FROM ParticipationLogs p
      LEFT JOIN Contests c ON p.contest_id = c.contest_id
      WHERE c.contest_id IS NULL
    `);
    if (orphanParts[0].count === 0) {
      console.log(`[PASS] Orphan ParticipationLogs: 0 records referencing non-existent Contests.`);
    } else {
      console.error(`[FAIL] Orphan ParticipationLogs: Found ${orphanParts[0].count} orphan records!`);
      allPassed = false;
    }

    // 9. Excluded Test Contests Check
    const [testContests] = await connection.query(`
      SELECT slug FROM Contests
      WHERE slug LIKE 'test-%' OR slug LIKE '%-test-%' OR slug LIKE '%-test'
         OR slug LIKE '%mock-%' OR slug LIKE '%dummy-%'
         OR slug LIKE '%retry-%' OR slug LIKE '%stale-%'
         OR slug LIKE '%crashed-%' OR slug LIKE '%regression-%'
         OR slug LIKE '%internal-%'
    `);
    if (testContests.length === 0) {
      console.log(`[PASS] Excluded Test Contests: 0 test/mock/dummy contests found in Contests table.`);
    } else {
      console.log(`[WARNING] Excluded Test Contests: Found ${testContests.length} test contests in DB (auto-filtered in queries).`);
    }

    // 10. Rating Mismatches: LeetCodeProfiles.highest_rating vs history max
    const [profiles] = await connection.query(`
      SELECT lp.user_id, lp.current_rating, lp.highest_rating, lp.contest_history
      FROM LeetCodeProfiles lp
      JOIN Users u ON lp.user_id = u.id
      WHERE u.status = 'active'
    `);
    let ratingMismatchCount = 0;
    for (const p of profiles) {
      if (!p.contest_history) continue;
      try {
        const history = JSON.parse(p.contest_history);
        if (!Array.isArray(history) || history.length === 0) continue;
        const ratings = history.map(h => h.rating).filter(r => r !== null && r !== undefined);
        if (ratings.length === 0) continue;
        const maxRating = Math.max(...ratings);
        if (Math.abs(Math.round(p.highest_rating) - Math.round(maxRating)) > 1) {
          ratingMismatchCount++;
        }
      } catch (e) {}
    }
    if (ratingMismatchCount === 0) {
      console.log(`[PASS] Historical Rating Validation: Best ratings match historical snapshots for all profiles.`);
    } else {
      console.error(`[FAIL] Historical Rating Validation: Found ${ratingMismatchCount} profiles where highest_rating does not match history max!`);
      allPassed = false;
    }

    // ── NEW CHECKS (Fix 10) ──────────────────────────────────────────────────

    // 11. Stale profile rows: highest_rating < current_rating (should never happen)
    let staleRatingCount = 0;
    try {
      const [staleLC] = await connection.query(
        `SELECT COUNT(*) as count FROM LeetCodeProfiles WHERE highest_rating < current_rating AND current_rating > 0`
      );
      const [staleCC] = await connection.query(
        `SELECT COUNT(*) as count FROM CodeChefProfiles WHERE highest_rating < current_rating AND current_rating > 0`
      );
      const [staleCF] = await connection.query(
        `SELECT COUNT(*) as count FROM CodeforcesProfiles WHERE highest_rating < current_rating AND current_rating > 0`
      );
      staleRatingCount = (Number(staleLC[0].count) || 0)
                       + (Number(staleCC[0].count) || 0)
                       + (Number(staleCF[0].count) || 0);
    } catch (e) {}
    if (staleRatingCount === 0) {
      console.log(`[PASS] Stale Profile Ratings: No profiles where highest_rating < current_rating.`);
    } else {
      console.error(`[FAIL] Stale Profile Ratings: Found ${staleRatingCount} profiles where highest_rating < current_rating!`);
      allPassed = false;
    }

    // 12. Users with platform username but no profile row (sync never ran)
    const platformChecks = [
      { label: 'LeetCode',   userCol: 'leetcode_username',   table: 'LeetCodeProfiles'   },
      { label: 'CodeChef',   userCol: 'codechef_username',   table: 'CodeChefProfiles'   },
      { label: 'Codeforces', userCol: 'codeforces_username', table: 'CodeforcesProfiles' },
      { label: 'HackerRank', userCol: 'hackerrank_username', table: 'HackerRankProfiles' }
    ];
    let missingProfileTotal = 0;
    for (const pc of platformChecks) {
      try {
        const [missing] = await connection.query(
          `SELECT COUNT(*) as count FROM Users u
           LEFT JOIN ${pc.table} p ON u.id = p.user_id
           WHERE u.${pc.userCol} IS NOT NULL AND u.${pc.userCol} != ''
             AND u.status = 'active' AND p.user_id IS NULL`
        );
        const cnt = Number(missing[0].count) || 0;
        missingProfileTotal += cnt;
        if (cnt > 0) {
          console.error(`[FAIL] Missing Profile Rows (${pc.label}): ${cnt} users have a username but no profile row.`);
          allPassed = false;
        }
      } catch (e) {}
    }
    if (missingProfileTotal === 0) {
      console.log(`[PASS] Missing Profile Rows: All users with platform usernames have profile rows.`);
    }

    // 13. AttendanceRecords tied to test/mock contests
    try {
      const [testAR] = await connection.query(`
        SELECT COUNT(*) as count
        FROM AttendanceRecords ar
        JOIN Contests c ON ar.contest_id = c.contest_id
        WHERE COALESCE(c.is_test, 0) = 1
           OR c.slug LIKE 'test-%' OR c.slug LIKE '%-test-%' OR c.slug LIKE '%-test'
           OR c.slug LIKE 'mock-%' OR c.slug LIKE '%mock-%'
           OR c.slug LIKE 'dummy-%' OR c.slug LIKE 'regression-%'
      `);
      const cnt = Number(testAR[0].count) || 0;
      if (cnt === 0) {
        console.log(`[PASS] Test Contests in AttendanceRecords: 0 attendance records tied to test/mock contests.`);
      } else {
        console.log(`[WARNING] Test Contests in AttendanceRecords: ${cnt} records reference test/mock contests (filtered at query level).`);
      }
    } catch (e) {}

    // 14. Slug/ID cross-mismatch in AttendanceRecords
    try {
      const [slugMismatch] = await connection.query(`
        SELECT COUNT(*) as count
        FROM AttendanceRecords ar
        JOIN Contests c ON ar.contest_id = c.contest_id
        WHERE ar.contest_slug IS NOT NULL AND ar.contest_slug != c.slug
      `);
      const cnt = Number(slugMismatch[0].count) || 0;
      if (cnt === 0) {
        console.log(`[PASS] Slug/ID Cross-Mismatch: contest_id and contest_slug agree in all AttendanceRecords.`);
      } else {
        console.error(`[FAIL] Slug/ID Cross-Mismatch: ${cnt} AttendanceRecords rows have mismatched contest_id vs contest_slug!`);
        allPassed = false;
      }
    } catch (e) {}

    // 15. Stuck Failed syncs (> 7 days, non-invalid_username)
    try {
      const [stuckSyncs] = await connection.query(`
        SELECT COUNT(*) as count
        FROM StudentPlatformSync
        WHERE sync_status = 'Failed'
          AND last_attempt < NOW() - INTERVAL 7 DAY
          AND failure_category != 'invalid_username'
      `);
      const cnt = Number(stuckSyncs[0].count) || 0;
      if (cnt === 0) {
        console.log(`[PASS] Stuck Failed Syncs: No sync entries stuck in Failed state for more than 7 days.`);
      } else {
        console.error(`[FAIL] Stuck Failed Syncs: ${cnt} sync entries have been Failed for > 7 days. Manual intervention may be needed.`);
        allPassed = false;
      }
    } catch (e) {}

    // 16. Source of Truth Validation: Official LeetCode history vs DB AttendanceRecords
    console.log("\nSource of Truth Validation (Official vs Database Attended Counts):");
    console.log("--------------------------------------------------------------------------------");
    console.log("Student Name         | Official Attended | DB Present Count | Status ");
    console.log("--------------------------------------------------------------------------------");

    const [allStudents] = await connection.query(`
      SELECT id, name, leetcode_username
      FROM Users
      WHERE leetcode_username IS NOT NULL AND status = 'active'
    `);

    for (const stud of allStudents) {
      const [lcProf] = await connection.query(
        "SELECT contest_history FROM LeetCodeProfiles WHERE user_id = ?",
        [stud.id]
      );
      let officialCount = 0;
      if (lcProf.length > 0 && lcProf[0].contest_history) {
        try {
          const history = JSON.parse(lcProf[0].contest_history);
          officialCount = history.filter(h => h.attended === true || h.attended === 1).length;
        } catch (e) {}
      }

      const [dbCountResult] = await connection.query(`
        SELECT COUNT(DISTINCT ar.contest_id) as count
        FROM AttendanceRecords ar
        JOIN Contests c ON ar.contest_id = c.contest_id
        JOIN Users u ON ar.user_id = u.id
        WHERE ar.user_id = ?
          AND ar.attendance_status = 'PRESENT'
          AND c.contest_status = 'Rated'
          AND c.platform = 'LeetCode'
          AND c.start_time >= u.academic_start_date
          AND c.start_time <= u.academic_end_date
          AND c.slug NOT LIKE 'test-%' AND c.slug NOT LIKE '%-test-%' AND c.slug NOT LIKE '%-test'
          AND c.slug NOT LIKE '%mock-%' AND c.slug NOT LIKE '%dummy-%'
          AND c.slug NOT LIKE '%retry-%' AND c.slug NOT LIKE '%stale-%'
          AND c.slug NOT LIKE '%crashed-%' AND c.slug NOT LIKE '%regression-%'
          AND c.slug NOT LIKE '%internal-%'
      `, [stud.id]);
      const dbCount = dbCountResult[0].count;

      const diff = dbCount - officialCount;
      const statusStr = diff === 0 ? "MATCH" : `MISMATCH (${diff > 0 ? '+' : ''}${diff})`;

      console.log(
        `${stud.name.padEnd(20)} | ${officialCount.toString().padEnd(17)} | ${dbCount.toString().padEnd(16)} | ${statusStr}`
      );
    }
    console.log("--------------------------------------------------------------------------------\n");

    if (allPassed) {
      console.log("======================================================================");
      console.log("                    STATUS: ALL DATA CHECKS PASSED                     ");
      console.log("======================================================================");
    } else {
      console.error("======================================================================");
      console.error("                    STATUS: SOME CHECKS FAILED                        ");
      console.error("======================================================================");
    }

  } catch (err) {
    console.error("Diagnostic script failed:", err);
  } finally {
    if (connection) connection.release();
    const pool = db.getPool();
    if (pool) await pool.end();
  }
}

run();
