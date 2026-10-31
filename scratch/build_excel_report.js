const fs = require('fs');
const path = require('path');
const xlsx = require('../backend/node_modules/xlsx');
const db = require('../backend/config/db');

async function main() {
  await db.initializeDatabase();

  // 1. All Students Detailed Report
  const studentRows = await db.query(`
    SELECT 
      u.roll_no AS "Register Number",
      u.name AS "Student Name",
      u.department AS "Department",
      u.section AS "Section",
      u.academic_batch AS "Batch",
      u.leetcode_username AS "LeetCode Username",
      COALESCE(lp.easy_solved, 0) AS "LeetCode Easy",
      COALESCE(lp.medium_solved, 0) AS "LeetCode Medium",
      COALESCE(lp.hard_solved, 0) AS "LeetCode Hard",
      COALESCE(lp.problems_solved, 0) AS "LeetCode Total",
      ROUND(COALESCE(lp.current_rating, 1500)) AS "LeetCode Rating",
      CASE WHEN cp.problems_solved IS NOT NULL THEN cp.problems_solved ELSE 'Not Available' END AS "CodeChef Solved",
      CASE WHEN cfp.problems_solved IS NOT NULL THEN cfp.problems_solved ELSE 'Not Available' END AS "Codeforces Solved",
      CASE WHEN hrp.problems_solved IS NOT NULL THEN hrp.problems_solved ELSE 'Not Available' END AS "HackerRank Solved",
      (COALESCE(lp.problems_solved, 0) + COALESCE(cp.problems_solved, 0) + COALESCE(cfp.problems_solved, 0) + COALESCE(hrp.problems_solved, 0)) AS "Grand Total Solved"
    FROM Users u
    LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
    LEFT JOIN CodeChefProfiles cp ON u.id = cp.user_id
    LEFT JOIN CodeforcesProfiles cfp ON u.id = cfp.user_id
    LEFT JOIN HackerRankProfiles hrp ON u.id = hrp.user_id
    WHERE u.status = 'active'
    ORDER BY u.roll_no ASC
  `);

  // 2. Section Summary
  const sectionRows = await db.query(`
    SELECT 
      u.section AS "Section",
      COUNT(u.id) AS "Total Students",
      SUM(lp.problems_solved) AS "LeetCode Solved",
      ROUND(AVG(lp.problems_solved), 1) AS "Avg LC Solved",
      ROUND(AVG(lp.current_rating), 1) AS "Avg LC Rating",
      SUM(COALESCE(cp.problems_solved, 0)) AS "CodeChef Solved",
      SUM(COALESCE(cfp.problems_solved, 0)) AS "Codeforces Solved",
      SUM(COALESCE(hrp.problems_solved, 0)) AS "HackerRank Solved",
      SUM(lp.problems_solved + COALESCE(cp.problems_solved, 0) + COALESCE(cfp.problems_solved, 0) + COALESCE(hrp.problems_solved, 0)) AS "Grand Total Solved"
    FROM Users u
    LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
    LEFT JOIN CodeChefProfiles cp ON u.id = cp.user_id
    LEFT JOIN CodeforcesProfiles cfp ON u.id = cfp.user_id
    LEFT JOIN HackerRankProfiles hrp ON u.id = hrp.user_id
    WHERE u.status = 'active'
    GROUP BY u.section
    ORDER BY u.section ASC
  `);

  // 3. College Summary
  const [lcTotals] = await db.query(`
    SELECT 
      COUNT(*) as total_students,
      SUM(problems_solved) as total_solved,
      SUM(easy_solved) as total_easy,
      SUM(medium_solved) as total_medium,
      SUM(hard_solved) as total_hard,
      ROUND(AVG(current_rating)) as avg_rating,
      ROUND(MIN(current_rating)) as min_rating,
      ROUND(MAX(current_rating)) as max_rating
    FROM LeetCodeProfiles lp
    JOIN Users u ON lp.user_id = u.id
    WHERE u.status = 'active'
  `);

  const [ccTotals] = await db.query(`
    SELECT SUM(problems_solved) as total_solved, COUNT(CASE WHEN problems_solved > 0 THEN 1 END) as active_solvers
    FROM CodeChefProfiles cp JOIN Users u ON cp.user_id = u.id WHERE u.status = 'active'
  `);
  const [cfTotals] = await db.query(`
    SELECT SUM(problems_solved) as total_solved, COUNT(CASE WHEN problems_solved > 0 THEN 1 END) as active_solvers
    FROM CodeforcesProfiles cfp JOIN Users u ON cfp.user_id = u.id WHERE u.status = 'active'
  `);
  const [hrTotals] = await db.query(`
    SELECT SUM(problems_solved) as total_solved, COUNT(CASE WHEN problems_solved > 0 THEN 1 END) as active_solvers
    FROM HackerRankProfiles hrp JOIN Users u ON hrp.user_id = u.id WHERE u.status = 'active'
  `);

  const grandTotal = (Number(lcTotals.total_solved) || 0) + (Number(ccTotals.total_solved) || 0) + (Number(cfTotals.total_solved) || 0) + (Number(hrTotals.total_solved) || 0);

  const summaryRows = [
    { 'Metric': 'Total Active Students Tracked', 'Value': lcTotals.total_students },
    { 'Metric': 'Grand Total Problems Solved (All Platforms)', 'Value': grandTotal },
    { 'Metric': 'LeetCode Total Problems Solved', 'Value': lcTotals.total_solved },
    { 'Metric': 'LeetCode Easy Solved', 'Value': lcTotals.total_easy },
    { 'Metric': 'LeetCode Medium Solved', 'Value': lcTotals.total_medium },
    { 'Metric': 'LeetCode Hard Solved', 'Value': lcTotals.total_hard },
    { 'Metric': 'LeetCode Average Rating', 'Value': lcTotals.avg_rating },
    { 'Metric': 'LeetCode Minimum Rating', 'Value': lcTotals.min_rating },
    { 'Metric': 'LeetCode Maximum Rating', 'Value': lcTotals.max_rating },
    { 'Metric': 'CodeChef Total Solved', 'Value': ccTotals.total_solved },
    { 'Metric': 'CodeChef Active Solvers', 'Value': ccTotals.active_solvers },
    { 'Metric': 'Codeforces Total Solved', 'Value': cfTotals.total_solved },
    { 'Metric': 'Codeforces Active Solvers', 'Value': cfTotals.active_solvers },
    { 'Metric': 'HackerRank Total Solved', 'Value': hrTotals.total_solved },
    { 'Metric': 'HackerRank Active Solvers', 'Value': hrTotals.active_solvers }
  ];

  // 4. Rating Distribution
  const tierRows = await db.query(`
    SELECT 
      CASE 
        WHEN lp.current_rating >= 2000 THEN '2000+ (Master / Knight)'
        WHEN lp.current_rating >= 1800 THEN '1800-1999 (Expert)'
        WHEN lp.current_rating >= 1600 THEN '1600-1799 (Advanced)'
        WHEN lp.current_rating >= 1400 THEN '1400-1599 (Intermediate)'
        ELSE '< 1400 (Beginner)'
      END AS "Rating Tier",
      COUNT(*) AS "Student Count",
      CONCAT(ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM Users WHERE status = 'active'), 1), '%') AS "Percentage",
      ROUND(AVG(lp.problems_solved), 1) AS "Avg Problems Solved"
    FROM LeetCodeProfiles lp
    JOIN Users u ON lp.user_id = u.id
    WHERE u.status = 'active'
    GROUP BY 
      CASE 
        WHEN lp.current_rating >= 2000 THEN '2000+ (Master / Knight)'
        WHEN lp.current_rating >= 1800 THEN '1800-1999 (Expert)'
        WHEN lp.current_rating >= 1600 THEN '1600-1799 (Advanced)'
        WHEN lp.current_rating >= 1400 THEN '1400-1599 (Intermediate)'
        ELSE '< 1400 (Beginner)'
      END
    ORDER BY MIN(lp.current_rating) DESC
  `);

  // 5. Top 50 Leaderboard
  const topRows = await db.query(`
    SELECT 
      u.roll_no AS "Register Number",
      u.name AS "Student Name",
      u.section AS "Section",
      ROUND(lp.current_rating) AS "LeetCode Rating",
      lp.problems_solved AS "LeetCode Solved",
      COALESCE(cp.problems_solved, 0) AS "CodeChef Solved",
      COALESCE(cfp.problems_solved, 0) AS "Codeforces Solved",
      COALESCE(hrp.problems_solved, 0) AS "HackerRank Solved",
      (lp.problems_solved + COALESCE(cp.problems_solved, 0) + COALESCE(cfp.problems_solved, 0) + COALESCE(hrp.problems_solved, 0)) AS "Grand Total Solved"
    FROM Users u
    JOIN LeetCodeProfiles lp ON u.id = lp.user_id
    LEFT JOIN CodeChefProfiles cp ON u.id = cp.user_id
    LEFT JOIN CodeforcesProfiles cfp ON u.id = cfp.user_id
    LEFT JOIN HackerRankProfiles hrp ON u.id = hrp.user_id
    WHERE u.status = 'active'
    ORDER BY (lp.problems_solved + COALESCE(cp.problems_solved, 0) + COALESCE(cfp.problems_solved, 0) + COALESCE(hrp.problems_solved, 0)) DESC
    LIMIT 50
  `);

  // Construct Multi-sheet Workbook
  const wb = xlsx.utils.book_new();

  const wsSummary = xlsx.utils.json_to_sheet(summaryRows);
  const wsTiers = xlsx.utils.json_to_sheet(tierRows);
  const wsSections = xlsx.utils.json_to_sheet(sectionRows);
  const wsTop = xlsx.utils.json_to_sheet(topRows);
  const wsStudents = xlsx.utils.json_to_sheet(studentRows);

  xlsx.utils.book_append_sheet(wb, wsSummary, 'Executive Summary');
  xlsx.utils.book_append_sheet(wb, wsTiers, 'Rating Tiers');
  xlsx.utils.book_append_sheet(wb, wsSections, 'Section Breakdown');
  xlsx.utils.book_append_sheet(wb, wsTop, 'Top 50 Leaderboard');
  xlsx.utils.book_append_sheet(wb, wsStudents, 'All 987 Students');

  const destPaths = [
    '/Users/vksanjay28/.gemini/antigravity/scratch/college/backend/updated_student_report.xlsx',
    '/Users/vksanjay28/.gemini/antigravity/scratch/college/updated_student_report.xlsx',
    '/Users/vksanjay28/.gemini/antigravity/scratch/updated_student_report.xlsx',
    '/Users/vksanjay28/.gemini/antigravity/brain/5dc1fb3c-98ca-40aa-8059-577fb526a223/updated_student_report.xlsx'
  ];

  for (const dp of destPaths) {
    xlsx.writeFile(wb, dp);
    console.log('Successfully wrote:', dp);
  }

  const pool = db.getPool();
  if (pool) await pool.end();
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
