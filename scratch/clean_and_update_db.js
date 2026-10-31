const fs = require('fs');
const path = require('path');
const db = require('../backend/config/db');

async function main() {
  console.log("======================================================================");
  console.log("       STEP 1: DATABASE INTEGRITY CLEANUP & SANITIZATION              ");
  console.log("======================================================================\n");

  await db.initializeDatabase();
  const pool = db.getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Purge fake contests (e.g. weekly-contest-999 and mock slugs)
    const [delContests] = await connection.query(`
      DELETE FROM Contests 
      WHERE slug = 'weekly-contest-999' OR slug LIKE 'crashed-contest-%' 
         OR slug LIKE 'retry-contest-%' OR slug LIKE 'stale-contest-%' 
         OR slug LIKE 'test-contest-%' OR slug LIKE 'test-reg-%'
         OR slug LIKE 'mock-%' OR slug LIKE 'dummy-%'
    `);
    console.log(`[Clean] Purged ${delContests.affectedRows || 0} fake/test contests from Contests table.`);

    const [delLive] = await connection.query(`
      DELETE FROM LiveContests 
      WHERE contestSlug = 'weekly-contest-999' OR contestSlug LIKE 'crashed-contest-%' 
         OR contestSlug LIKE 'retry-contest-%' OR contestSlug LIKE 'stale-contest-%' 
         OR contestSlug LIKE 'test-contest-%' OR contestSlug LIKE 'test-reg-%'
         OR contestSlug LIKE 'mock-%' OR contestSlug LIKE 'dummy-%'
    `);
    console.log(`[Clean] Purged ${delLive.affectedRows || 0} fake/test contests from LiveContests table.`);

    // 2. Remove orphan records
    const [delAR] = await connection.query(`
      DELETE FROM AttendanceRecords 
      WHERE contest_id NOT IN (SELECT contest_id FROM Contests)
    `);
    console.log(`[Clean] Purged ${delAR.affectedRows || 0} orphan AttendanceRecords.`);

    const [delCP] = await connection.query(`
      DELETE FROM ContestParticipants 
      WHERE contest_slug NOT IN (SELECT slug FROM Contests)
    `);
    console.log(`[Clean] Purged ${delCP.affectedRows || 0} orphan ContestParticipants.`);

    const [delReg] = await connection.query(`
      DELETE FROM Registrations 
      WHERE contest_id NOT IN (SELECT contest_id FROM Contests)
    `);
    console.log(`[Clean] Purged ${delReg.affectedRows || 0} orphan Registrations.`);

    const [delPart] = await connection.query(`
      DELETE FROM ParticipationLogs 
      WHERE contest_id NOT IN (SELECT contest_id FROM Contests)
    `);
    console.log(`[Clean] Purged ${delPart.affectedRows || 0} orphan ParticipationLogs.`);

    // 3. Fix stale ratings: ensure highest_rating >= current_rating for all profiles
    const [staleLC] = await connection.query(`
      UPDATE LeetCodeProfiles 
      SET highest_rating = current_rating 
      WHERE highest_rating < current_rating AND current_rating > 0
    `);
    console.log(`[Clean] Fixed ${staleLC.affectedRows || 0} LeetCodeProfiles where highest_rating < current_rating.`);

    const [staleCC] = await connection.query(`
      UPDATE CodeChefProfiles 
      SET highest_rating = current_rating 
      WHERE highest_rating < current_rating AND current_rating > 0
    `);
    console.log(`[Clean] Fixed ${staleCC.affectedRows || 0} CodeChefProfiles where highest_rating < current_rating.`);

    const [staleCF] = await connection.query(`
      UPDATE CodeforcesProfiles 
      SET highest_rating = current_rating 
      WHERE highest_rating < current_rating AND current_rating > 0
    `);
    console.log(`[Clean] Fixed ${staleCF.affectedRows || 0} CodeforcesProfiles where highest_rating < current_rating.`);

    // 4. Resolve stuck failed syncs (> 7 days)
    const [stuckSyncs] = await connection.query(`
      UPDATE StudentPlatformSync 
      SET sync_status = 'Never Synced', 
          failure_reason = NULL, 
          failure_category = NULL, 
          retry_count = 0, 
          last_attempt = NULL 
      WHERE sync_status = 'Failed' 
        AND last_attempt < NOW() - INTERVAL 7 DAY 
        AND failure_category != 'invalid_username'
    `);
    console.log(`[Clean] Reset ${stuckSyncs.affectedRows || 0} stuck failed sync entries in StudentPlatformSync.`);

    // Commit step 1
    await connection.commit();
    console.log("\n✓ Database cleanup and sanitization committed successfully.\n");

    console.log("======================================================================");
    console.log("       STEP 2: UPDATING DATABASE WITH FRESH CSV STATS                 ");
    console.log("======================================================================\n");

    const csvPath = path.resolve(__dirname, 'provided_students.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const lines = csvContent.trim().split('\n');

    console.log(`Processing ${lines.length - 1} student records from CSV...`);

    // Fetch existing users mapping
    const [users] = await connection.query("SELECT id, roll_no, leetcode_username FROM Users");
    const userMap = new Map();
    for (const u of users) {
      userMap.set(u.roll_no.trim().toUpperCase(), u);
    }

    await connection.beginTransaction();

    let lcUpdates = 0;
    let ccUpdates = 0;
    let cfUpdates = 0;
    let hrUpdates = 0;

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < 11) continue;

      const [name, rollNo, lcUser, lcEasyStr, lcMedStr, lcHardStr, lcTotalStr, lcRatingStr, ccSolvedStr, cfSolvedStr, hrSolvedStr] = parts;
      const rollKey = rollNo.trim().toUpperCase();
      const user = userMap.get(rollKey);

      if (!user) {
        console.warn(`[Warning] No user found in DB for roll_no: ${rollNo}`);
        continue;
      }

      const userId = user.id;

      // Parse numerical values safely
      const easySolved = parseInt(lcEasyStr, 10) || 0;
      const mediumSolved = parseInt(lcMedStr, 10) || 0;
      const hardSolved = parseInt(lcHardStr, 10) || 0;
      const totalSolved = parseInt(lcTotalStr, 10) || (easySolved + mediumSolved + hardSolved);
      const rating = parseFloat(lcRatingStr) || 1500;

      // Update LeetCodeProfiles
      await connection.query(`
        INSERT INTO LeetCodeProfiles (user_id, easy_solved, medium_solved, hard_solved, problems_solved, current_rating, highest_rating, last_synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          easy_solved = VALUES(easy_solved),
          medium_solved = VALUES(medium_solved),
          hard_solved = VALUES(hard_solved),
          problems_solved = VALUES(problems_solved),
          current_rating = VALUES(current_rating),
          highest_rating = GREATEST(COALESCE(highest_rating, 0), VALUES(current_rating)),
          last_synced = NOW()
      `, [userId, easySolved, mediumSolved, hardSolved, totalSolved, rating, rating]);
      lcUpdates++;

      // Update CodeChefProfiles if available
      if (ccSolvedStr && ccSolvedStr.trim().toLowerCase() !== 'not available') {
        const ccSolved = parseInt(ccSolvedStr, 10) || 0;
        await connection.query(`
          INSERT INTO CodeChefProfiles (user_id, problems_solved, last_synced)
          VALUES (?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            problems_solved = VALUES(problems_solved),
            last_synced = NOW()
        `, [userId, ccSolved]);
        ccUpdates++;
      }

      // Update CodeforcesProfiles if available
      if (cfSolvedStr && cfSolvedStr.trim().toLowerCase() !== 'not available') {
        const cfSolved = parseInt(cfSolvedStr, 10) || 0;
        await connection.query(`
          INSERT INTO CodeforcesProfiles (user_id, problems_solved, last_synced)
          VALUES (?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            problems_solved = VALUES(problems_solved),
            last_synced = NOW()
        `, [userId, cfSolved]);
        cfUpdates++;
      }

      // Update HackerRankProfiles if available
      if (hrSolvedStr && hrSolvedStr.trim().toLowerCase() !== 'not available') {
        const hrSolved = parseInt(hrSolvedStr, 10) || 0;
        await connection.query(`
          INSERT INTO HackerRankProfiles (user_id, problems_solved, last_synced)
          VALUES (?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            problems_solved = VALUES(problems_solved),
            last_synced = NOW()
        `, [userId, hrSolved]);
        hrUpdates++;
      }
    }

    await connection.commit();
    console.log(`✓ Student profiles successfully updated:`);
    console.log(`   - LeetCode profiles updated:   ${lcUpdates}`);
    console.log(`   - CodeChef profiles updated:   ${ccUpdates}`);
    console.log(`   - Codeforces profiles updated: ${cfUpdates}`);
    console.log(`   - HackerRank profiles updated: ${hrUpdates}\n`);

    // Invalidate Cache
    const cache = require('../backend/services/analyticsCacheService');
    cache.invalidateAll();
    console.log("✓ Analytics cache invalidated.\n");

    console.log("======================================================================");
    console.log("       STEP 3: FETCHING UPDATED AGGREGATE REPORT & COUNTS             ");
    console.log("======================================================================\n");

    // 1. Overall Problem Solving Totals
    const [lcTotals] = await connection.query(`
      SELECT 
        COUNT(*) as total_students,
        SUM(problems_solved) as total_solved,
        SUM(easy_solved) as total_easy,
        SUM(medium_solved) as total_medium,
        SUM(hard_solved) as total_hard,
        AVG(current_rating) as avg_rating,
        MIN(current_rating) as min_rating,
        MAX(current_rating) as max_rating
      FROM LeetCodeProfiles lp
      JOIN Users u ON lp.user_id = u.id
      WHERE u.status = 'active'
    `);

    const [ccTotals] = await connection.query(`
      SELECT 
        SUM(problems_solved) as total_solved,
        COUNT(CASE WHEN problems_solved > 0 THEN 1 END) as active_solvers
      FROM CodeChefProfiles cp
      JOIN Users u ON cp.user_id = u.id
      WHERE u.status = 'active'
    `);

    const [cfTotals] = await connection.query(`
      SELECT 
        SUM(problems_solved) as total_solved,
        COUNT(CASE WHEN problems_solved > 0 THEN 1 END) as active_solvers
      FROM CodeforcesProfiles cfp
      JOIN Users u ON cfp.user_id = u.id
      WHERE u.status = 'active'
    `);

    const [hrTotals] = await connection.query(`
      SELECT 
        SUM(problems_solved) as total_solved,
        COUNT(CASE WHEN problems_solved > 0 THEN 1 END) as active_solvers
      FROM HackerRankProfiles hrp
      JOIN Users u ON hrp.user_id = u.id
      WHERE u.status = 'active'
    `);

    const grandTotal = (Number(lcTotals[0].total_solved) || 0)
                     + (Number(ccTotals[0].total_solved) || 0)
                     + (Number(cfTotals[0].total_solved) || 0)
                     + (Number(hrTotals[0].total_solved) || 0);

    console.log("COLLEGE-WIDE PLATFORM SUMMARY:");
    console.log("----------------------------------------------------------------------");
    console.log(`Active Students:               ${lcTotals[0].total_students}`);
    console.log(`Total Problems Solved (All):   ${grandTotal.toLocaleString()}`);
    console.log(`LeetCode Total Solved:         ${Number(lcTotals[0].total_solved).toLocaleString()}`);
    console.log(`   - Easy Solved:              ${Number(lcTotals[0].total_easy).toLocaleString()}`);
    console.log(`   - Medium Solved:            ${Number(lcTotals[0].total_medium).toLocaleString()}`);
    console.log(`   - Hard Solved:              ${Number(lcTotals[0].total_hard).toLocaleString()}`);
    console.log(`LeetCode Rating:`);
    console.log(`   - Average:                  ${Math.round(lcTotals[0].avg_rating)}`);
    console.log(`   - Min:                      ${Math.round(lcTotals[0].min_rating)}`);
    console.log(`   - Max:                      ${Math.round(lcTotals[0].max_rating)}`);
    console.log(`CodeChef Total Solved:         ${Number(ccTotals[0].total_solved).toLocaleString()} (${ccTotals[0].active_solvers} active solvers)`);
    console.log(`Codeforces Total Solved:       ${Number(cfTotals[0].total_solved).toLocaleString()} (${cfTotals[0].active_solvers} active solvers)`);
    console.log(`HackerRank Total Solved:       ${Number(hrTotals[0].total_solved).toLocaleString()} (${hrTotals[0].active_solvers} active solvers)`);
    console.log("----------------------------------------------------------------------\n");

    // 2. Section-wise Breakdown
    const [sections] = await connection.query(`
      SELECT 
        u.section,
        COUNT(u.id) as student_count,
        SUM(lp.problems_solved) as lc_solved,
        ROUND(AVG(lp.problems_solved), 1) as avg_lc_solved,
        ROUND(AVG(lp.current_rating), 1) as avg_lc_rating,
        SUM(COALESCE(cp.problems_solved, 0)) as cc_solved,
        SUM(COALESCE(cfp.problems_solved, 0)) as cf_solved,
        SUM(COALESCE(hrp.problems_solved, 0)) as hr_solved,
        SUM(lp.problems_solved + COALESCE(cp.problems_solved, 0) + COALESCE(cfp.problems_solved, 0) + COALESCE(hrp.problems_solved, 0)) as grand_total_solved
      FROM Users u
      LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
      LEFT JOIN CodeChefProfiles cp ON u.id = cp.user_id
      LEFT JOIN CodeforcesProfiles cfp ON u.id = cfp.user_id
      LEFT JOIN HackerRankProfiles hrp ON u.id = hrp.user_id
      WHERE u.status = 'active'
      GROUP BY u.section
      ORDER BY u.section ASC
    `);

    console.log("SECTION-WISE BREAKDOWN:");
    console.table(sections);

    // 3. Rating Tiers Distribution
    const [tiers] = await connection.query(`
      SELECT 
        CASE 
          WHEN lp.current_rating >= 2000 THEN '2000+ (Master / Knight)'
          WHEN lp.current_rating >= 1800 THEN '1800-1999 (Expert)'
          WHEN lp.current_rating >= 1600 THEN '1600-1799 (Advanced)'
          WHEN lp.current_rating >= 1400 THEN '1400-1599 (Intermediate)'
          ELSE '< 1400 (Beginner)'
        END as rating_tier,
        COUNT(*) as student_count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM Users WHERE status = 'active'), 1) as percentage,
        ROUND(AVG(lp.problems_solved), 1) as avg_solved
      FROM LeetCodeProfiles lp
      JOIN Users u ON lp.user_id = u.id
      WHERE u.status = 'active'
      GROUP BY rating_tier
      ORDER BY MIN(lp.current_rating) DESC
    `);

    console.log("RATING TIERS DISTRIBUTION:");
    console.table(tiers);

    // 4. Top 15 Overall Problem Solvers
    const [topSolvers] = await connection.query(`
      SELECT 
        u.roll_no,
        u.name,
        u.section,
        lp.current_rating as lc_rating,
        lp.easy_solved as easy,
        lp.medium_solved as med,
        lp.hard_solved as hard,
        lp.problems_solved as lc_total,
        COALESCE(cp.problems_solved, 0) as cc_total,
        COALESCE(cfp.problems_solved, 0) as cf_total,
        COALESCE(hrp.problems_solved, 0) as hr_total,
        (lp.problems_solved + COALESCE(cp.problems_solved, 0) + COALESCE(cfp.problems_solved, 0) + COALESCE(hrp.problems_solved, 0)) as total_all
      FROM Users u
      JOIN LeetCodeProfiles lp ON u.id = lp.user_id
      LEFT JOIN CodeChefProfiles cp ON u.id = cp.user_id
      LEFT JOIN CodeforcesProfiles cfp ON u.id = cfp.user_id
      LEFT JOIN HackerRankProfiles hrp ON u.id = hrp.user_id
      WHERE u.status = 'active'
      ORDER BY total_all DESC
      LIMIT 15
    `);

    console.log("TOP 15 OVERALL PROBLEM SOLVERS:");
    console.table(topSolvers);

  } catch (err) {
    await connection.rollback();
    console.error("Execution failed:", err);
    throw err;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
