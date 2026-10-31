const fs = require('fs');
const path = require('path');
const db = require('../backend/config/db');

async function main() {
  console.log("======================================================================");
  console.log("       INITIALIZING MODERN SCHEMA ON TIDB CLUSTER                     ");
  console.log("======================================================================\n");

  await db.initializeDatabase();
  const pool = db.getPool();
  const connection = await pool.getConnection();

  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    // 1. Departments Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        code VARCHAR(50) NOT NULL UNIQUE,
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_dept_code (code)
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created departments table.");

    // 2. Colleges Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS colleges (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        code VARCHAR(50) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created colleges table.");

    // 3. Users Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS Users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        college_code VARCHAR(50) DEFAULT 'DEC',
        name VARCHAR(100) NOT NULL,
        roll_no VARCHAR(50) NOT NULL UNIQUE,
        department VARCHAR(100) NOT NULL,
        section VARCHAR(20) NOT NULL,
        leetcode_username VARCHAR(100) NOT NULL UNIQUE,
        academic_batch VARCHAR(50) NOT NULL DEFAULT '2024-2028',
        academic_start_date DATE NOT NULL,
        academic_end_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        codechef_username VARCHAR(100) DEFAULT NULL,
        codeforces_username VARCHAR(100) DEFAULT NULL,
        hackerrank_username VARCHAR(100) DEFAULT NULL,
        codeforces_username_normalized VARCHAR(100) DEFAULT NULL,
        codeforces_verified TINYINT(1) DEFAULT 1,
        codeforces_verified_at TIMESTAMP NULL DEFAULT NULL,
        codeforces_verified_source VARCHAR(50) DEFAULT 'BULK_IMPORT',
        email VARCHAR(150) DEFAULT NULL,
        phone_number VARCHAR(50) DEFAULT NULL,
        remarks TEXT DEFAULT NULL,
        INDEX idx_users_roll (roll_no),
        INDEX idx_users_lc (leetcode_username),
        INDEX idx_users_batch_dept (academic_batch, department)
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created Users table.");

    // 4. LeetCodeProfiles Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS LeetCodeProfiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        current_rating DECIMAL(10,2) DEFAULT 1500.00,
        highest_rating DECIMAL(10,2) DEFAULT 1500.00,
        global_ranking INT DEFAULT NULL,
        problems_solved INT DEFAULT 0,
        easy_solved INT DEFAULT 0,
        medium_solved INT DEFAULT 0,
        hard_solved INT DEFAULT 0,
        active_days INT DEFAULT 0,
        contest_history LONGTEXT DEFAULT NULL,
        submission_calendar JSON DEFAULT NULL,
        badges JSON DEFAULT NULL,
        language_stats JSON DEFAULT NULL,
        topic_stats JSON DEFAULT NULL,
        recent_submissions JSON DEFAULT NULL,
        acceptance_rate DECIMAL(5,2) DEFAULT NULL,
        last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created LeetCodeProfiles table.");

    // 5. CodeChefProfiles Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS CodeChefProfiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        current_rating INT DEFAULT NULL,
        highest_rating INT DEFAULT NULL,
        lowest_rating INT DEFAULT NULL,
        is_provisional TINYINT(1) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'UNRATED',
        global_ranking INT DEFAULT NULL,
        country_rank INT DEFAULT NULL,
        problems_solved INT DEFAULT 0,
        stars VARCHAR(10) DEFAULT NULL,
        contest_history JSON DEFAULT NULL,
        rating_history JSON DEFAULT NULL,
        last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created CodeChefProfiles table.");

    // 6. CodeforcesProfiles Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS CodeforcesProfiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        current_rating INT DEFAULT 0,
        highest_rating INT DEFAULT 0,
        \`rank\` VARCHAR(50) DEFAULT NULL,
        max_rank VARCHAR(50) DEFAULT NULL,
        problems_solved INT DEFAULT 0,
        contest_history JSON DEFAULT NULL,
        last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_profile_sync TIMESTAMP NULL DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created CodeforcesProfiles table.");

    // 7. HackerRankProfiles Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS HackerRankProfiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        badges JSON DEFAULT NULL,
        stars INT DEFAULT 0,
        certificates JSON DEFAULT NULL,
        problems_solved INT DEFAULT 0,
        last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created HackerRankProfiles table.");

    // 8. Contests Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS Contests (
        contest_id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL UNIQUE,
        platform VARCHAR(50) DEFAULT 'LeetCode',
        start_time DATETIME NOT NULL,
        end_time DATETIME DEFAULT NULL,
        duration INT DEFAULT 5400,
        contest_type ENUM('Weekly','Biweekly') NOT NULL DEFAULT 'Weekly',
        contest_status ENUM('Rated','Unrated','Cancelled') NOT NULL DEFAULT 'Rated',
        contest_number INT NOT NULL DEFAULT 0,
        total_problems INT DEFAULT 4,
        is_test TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_contests_slug (slug),
        INDEX idx_contests_platform (platform),
        INDEX idx_contests_start (start_time)
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created Contests table.");

    // 9. LiveContests Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS LiveContests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contestName VARCHAR(255) NOT NULL,
        contestSlug VARCHAR(255) NOT NULL UNIQUE,
        platform VARCHAR(50) DEFAULT 'LeetCode',
        startTime DATETIME NOT NULL,
        endTime DATETIME DEFAULT NULL,
        status VARCHAR(50) DEFAULT 'Scheduled',
        totalParticipants INT DEFAULT 0,
        lastSyncAt TIMESTAMP NULL DEFAULT NULL
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created LiveContests table.");

    // 10. AttendanceRecords Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS AttendanceRecords (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        contest_id INT NOT NULL,
        contest_slug VARCHAR(255) NOT NULL,
        attendance_status ENUM('PRESENT', 'ABSENT') NOT NULL,
        \`rank\` INT DEFAULT NULL,
        score DECIMAL(10,2) DEFAULT NULL,
        problems_solved INT DEFAULT 0,
        finish_time INT DEFAULT NULL,
        rating_before DECIMAL(10,2) DEFAULT NULL,
        rating_after DECIMAL(10,2) DEFAULT NULL,
        rating_change DECIMAL(10,2) DEFAULT NULL,
        attendance_source VARCHAR(50) DEFAULT 'AUTO',
        remarks TEXT DEFAULT NULL,
        synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_user_contest (user_id, contest_id),
        INDEX idx_ar_user (user_id),
        INDEX idx_ar_contest (contest_id)
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created AttendanceRecords table.");

    // 11. Registrations & ParticipationLogs
    await connection.query(`
      CREATE TABLE IF NOT EXISTS Registrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        contest_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_reg (user_id, contest_id)
      ) ENGINE=InnoDB
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ParticipationLogs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        contest_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_part (user_id, contest_id)
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created Registrations and ParticipationLogs tables.");

    // 12. StudentPlatformSync Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS StudentPlatformSync (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        platform VARCHAR(50) NOT NULL,
        username VARCHAR(255) DEFAULT NULL,
        sync_status VARCHAR(20) DEFAULT 'Never Synced',
        last_successful_sync TIMESTAMP NULL DEFAULT NULL,
        last_attempt TIMESTAMP NULL DEFAULT NULL,
        retry_count INT DEFAULT 0,
        failure_reason TEXT DEFAULT NULL,
        failure_category VARCHAR(100) DEFAULT NULL,
        data_completeness INT DEFAULT 0,
        next_retry TIMESTAMP NULL DEFAULT NULL,
        UNIQUE KEY idx_user_platform (user_id, platform),
        FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created StudentPlatformSync table.");

    // 13. Audit and Logging tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS AuditLog (
        id INT AUTO_INCREMENT PRIMARY KEY,
        action VARCHAR(100) NOT NULL,
        details JSON DEFAULT NULL,
        user_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS BulkImportAuditLogs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(100) NOT NULL,
        imported_by VARCHAR(100) DEFAULT 'System',
        academic_batch VARCHAR(50) DEFAULT 'N/A',
        total_rows INT DEFAULT 0,
        imported_count INT DEFAULT 0,
        invalid_count INT DEFAULT 0,
        skipped_count INT DEFAULT 0,
        duplicate_count INT DEFAULT 0,
        pending_count INT DEFAULT 0,
        processing_time_ms INT DEFAULT 0,
        report_details JSON DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        status VARCHAR(50) NOT NULL,
        contests_synced INT DEFAULT 0,
        students_processed INT DEFAULT 0,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL DEFAULT NULL,
        error_message TEXT DEFAULT NULL
      ) ENGINE=InnoDB
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT DEFAULT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'info',
        is_read TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    console.log("✓ Created logging and audit tables.");

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    // 14. Seed Default College and 12 Departments
    await connection.query("INSERT IGNORE INTO colleges (name, code) VALUES ('Default Engineering College', 'DEC')");
    const defaultDepts = [
      ['CSE', 'Computer Science Engineering', 'active'],
      ['CSBS', 'Computer Science & Business Systems', 'active'],
      ['AIDS', 'Artificial Intelligence & Data Science', 'active'],
      ['AIML', 'Artificial Intelligence & Machine Learning', 'active'],
      ['CYBER', 'Cyber Security', 'active'],
      ['IT', 'Information Technology', 'active'],
      ['ECE', 'Electronics & Communication Engineering', 'active'],
      ['EEE', 'Electrical & Electronics Engineering', 'active'],
      ['BME', 'Biomedical Engineering', 'active'],
      ['MECH', 'Mechanical Engineering', 'active'],
      ['CIVIL', 'Civil Engineering', 'active'],
      ['BIOTECH', 'Biotechnology', 'active']
    ];
    for (const [code, name, status] of defaultDepts) {
      await connection.query("INSERT IGNORE INTO departments (code, name, status) VALUES (?, ?, ?)", [code, name, status]);
    }
    console.log("✓ Seeded default college and departments.");

    // 15. Populate All 987 Students and Live Stats
    console.log("\n======================================================================");
    console.log("       POPULATING 987 STUDENTS AND UPDATED PROFILES                   ");
    console.log("======================================================================\n");

    const csvPath = path.resolve(__dirname, 'provided_students.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const lines = csvContent.trim().split('\n');

    let insertedStudents = 0;
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < 11) continue;

      const [name, rollNo, lcUser, lcEasyStr, lcMedStr, lcHardStr, lcTotalStr, lcRatingStr, ccSolvedStr, cfSolvedStr, hrSolvedStr] = parts;
      const roll = rollNo.trim().toUpperCase();
      const lc = lcUser.trim();

      // Section derivation: 24CS0001 -> Section A, 24CS0060 -> Section B, etc.
      // Or determine section based on sequence
      let section = 'A';
      const numMatch = roll.match(/\d+$/);
      if (numMatch) {
        const num = parseInt(numMatch[0], 10);
        if (num <= 56) section = 'A';
        else if (num <= 114) section = 'B';
        else if (num <= 176) section = 'C';
        else if (num <= 235) section = 'D';
        else if (num <= 291) section = 'E';
        else if (num <= 352) section = 'F';
        else if (num <= 411) section = 'G';
        else if (num <= 471) section = 'H';
        else if (num <= 532) section = 'I';
        else if (num <= 590) section = 'J';
        else if (num <= 619) section = 'K';
        else if (num <= 675) section = 'L';
        else if (num <= 734) section = 'M';
        else if (num <= 799) section = 'N';
        else if (num <= 864) section = 'O';
        else if (num <= 923) section = 'P';
        else section = 'Q';
      }

      const [userRes] = await connection.query(`
        INSERT INTO Users (name, roll_no, department, section, leetcode_username, academic_batch, academic_start_date, academic_end_date, status, college_code)
        VALUES (?, ?, 'CSE', ?, ?, '2024-2028', '2024-07-01', '2028-06-30', 'active', 'DEC')
        ON DUPLICATE KEY UPDATE 
          name = VALUES(name),
          leetcode_username = VALUES(leetcode_username)
      `, [name.trim(), roll, section, lc]);

      const userId = userRes.insertId || (await connection.query("SELECT id FROM Users WHERE roll_no = ?", [roll]))[0]?.id;

      if (!userId) continue;

      const easy = parseInt(lcEasyStr, 10) || 0;
      const med = parseInt(lcMedStr, 10) || 0;
      const hard = parseInt(lcHardStr, 10) || 0;
      const total = parseInt(lcTotalStr, 10) || (easy + med + hard);
      const rating = parseFloat(lcRatingStr) || 1500;

      await connection.query(`
        INSERT INTO LeetCodeProfiles (user_id, easy_solved, medium_solved, hard_solved, problems_solved, current_rating, highest_rating)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          easy_solved = VALUES(easy_solved),
          medium_solved = VALUES(medium_solved),
          hard_solved = VALUES(hard_solved),
          problems_solved = VALUES(problems_solved),
          current_rating = VALUES(current_rating),
          highest_rating = GREATEST(COALESCE(highest_rating, 0), VALUES(current_rating))
      `, [userId, easy, med, hard, total, rating, rating]);

      if (ccSolvedStr && ccSolvedStr.trim().toLowerCase() !== 'not available') {
        const cc = parseInt(ccSolvedStr, 10) || 0;
        await connection.query(`
          INSERT INTO CodeChefProfiles (user_id, problems_solved)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE problems_solved = VALUES(problems_solved)
        `, [userId, cc]);
      }

      if (cfSolvedStr && cfSolvedStr.trim().toLowerCase() !== 'not available') {
        const cf = parseInt(cfSolvedStr, 10) || 0;
        await connection.query(`
          INSERT INTO CodeforcesProfiles (user_id, problems_solved)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE problems_solved = VALUES(problems_solved)
        `, [userId, cf]);
      }

      if (hrSolvedStr && hrSolvedStr.trim().toLowerCase() !== 'not available') {
        const hr = parseInt(hrSolvedStr, 10) || 0;
        await connection.query(`
          INSERT INTO HackerRankProfiles (user_id, problems_solved)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE problems_solved = VALUES(problems_solved)
        `, [userId, hr]);
      }

      insertedStudents++;
    }

    console.log(`✓ Successfully initialized ${insertedStudents} student records on TiDB Cloud!`);

    // Invalidate cache
    const cache = require('../backend/services/analyticsCacheService');
    cache.invalidateAll();

    console.log("\n======================================================================");
    console.log("       TIDB CLUSTER INITIALIZATION COMPLETE & VERIFIED!                ");
    console.log("======================================================================\n");

  } catch (err) {
    console.error("Initialization error:", err);
  } finally {
    connection.release();
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
