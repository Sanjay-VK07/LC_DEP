const db = require('../backend/config/db');

async function main() {
  await db.initializeDatabase();
  const pool = db.getPool();
  const conn = await pool.getConnection();

  try {
    console.log("Creating missing contest attendance tables on TiDB...");

    // 1. LiveContests
    await conn.query(`
      CREATE TABLE IF NOT EXISTS LiveContests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contestName VARCHAR(255) NOT NULL,
        contestSlug VARCHAR(255) NOT NULL UNIQUE,
        platform VARCHAR(50) DEFAULT 'LeetCode',
        startTime DATETIME NOT NULL,
        endTime DATETIME DEFAULT NULL,
        status VARCHAR(50) DEFAULT 'Scheduled',
        totalParticipants INT DEFAULT 0,
        lastSyncAt TIMESTAMP NULL DEFAULT NULL,
        currentSyncPass INT DEFAULT 0,
        syncProgress DECIMAL(5,2) DEFAULT 0.00,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_lc_status (status),
        INDEX idx_lc_slug (contestSlug)
      ) ENGINE=InnoDB
    `);
    console.log("✓ LiveContests verified.");

    // 2. ContestAttendance
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ContestAttendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contestId INT NOT NULL,
        studentId INT NOT NULL,
        username VARCHAR(100) NOT NULL,
        attendanceStatus ENUM('Unknown', 'Participating', 'Present', 'Absent', 'Pending', 'Verified') NOT NULL DEFAULT 'Pending',
        \`rank\` INT DEFAULT NULL,
        solved INT DEFAULT 0,
        score DECIMAL(10,2) DEFAULT 0.00,
        penalty INT DEFAULT 0,
        ratingBefore DECIMAL(8,3) DEFAULT NULL,
        ratingAfter DECIMAL(8,3) DEFAULT NULL,
        ratingChange DECIMAL(8,3) DEFAULT NULL,
        verified TINYINT(1) DEFAULT 0,
        syncPass INT DEFAULT 0,
        syncProvider VARCHAR(50) DEFAULT NULL,
        attendanceSource VARCHAR(50) DEFAULT 'AUTO',
        verificationMethod VARCHAR(50) DEFAULT 'MANUAL',
        syncStatus VARCHAR(50) DEFAULT 'COMPLETED',
        upstreamError TEXT DEFAULT NULL,
        firstDetectedAt TIMESTAMP NULL DEFAULT NULL,
        lastUpdatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_student_live_contest (studentId, contestId),
        INDEX idx_ca_contest_student (contestId, studentId),
        INDEX idx_ca_status (attendanceStatus),
        INDEX idx_ca_updated (lastUpdatedAt)
      ) ENGINE=InnoDB
    `);
    console.log("✓ ContestAttendance created.");

    // 3. ContestParticipants
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ContestParticipants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contest_slug VARCHAR(255) NOT NULL,
        username VARCHAR(100) NOT NULL,
        \`rank\` INT NOT NULL,
        score DECIMAL(10,2) NOT NULL,
        problems_solved INT DEFAULT 0,
        finish_time INT NOT NULL,
        avatar VARCHAR(255) DEFAULT NULL,
        country VARCHAR(100) DEFAULT NULL,
        page_number INT NOT NULL DEFAULT 1,
        synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_contest_username (contest_slug, username),
        INDEX idx_cp_contest_slug (contest_slug),
        INDEX idx_cp_username (username)
      ) ENGINE=InnoDB
    `);
    console.log("✓ ContestParticipants created.");

    // 4. ContestSnapshots
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ContestSnapshots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contestId INT NOT NULL,
        snapshotTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        participants INT DEFAULT 0,
        attendancePercentage DECIMAL(5,2) DEFAULT 0.00,
        averageSolved DECIMAL(5,2) DEFAULT 0.00,
        highestRank INT DEFAULT NULL,
        averageRank DECIMAL(10,2) DEFAULT NULL,
        INDEX idx_snapshots_contest (contestId)
      ) ENGINE=InnoDB
    `);
    console.log("✓ ContestSnapshots created.");

    // 5. ContestSyncLog
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ContestSyncLog (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contestId INT NOT NULL,
        contest_slug VARCHAR(255) DEFAULT NULL,
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME NULL DEFAULT NULL,
        syncStarted DATETIME NULL DEFAULT NULL,
        syncCompleted DATETIME NULL DEFAULT NULL,
        pagesFetched INT DEFAULT 0,
        participantsFetched INT DEFAULT 0,
        total_requests INT DEFAULT 0,
        failed_requests INT DEFAULT 0,
        retry_count INT DEFAULT 0,
        sync_status VARCHAR(50) DEFAULT 'RUNNING',
        last_page_synced INT DEFAULT 0,
        INDEX idx_csl_contest (contestId),
        INDEX idx_csl_slug (contest_slug)
      ) ENGINE=InnoDB
    `);
    console.log("✓ ContestSyncLog created.");

    // 6. ContestLeaderboardSnapshots
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ContestLeaderboardSnapshots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contest_slug VARCHAR(255) NOT NULL,
        page_number INT NOT NULL,
        raw_json LONGTEXT NOT NULL,
        downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_contest_page (contest_slug, page_number),
        INDEX idx_cls_contest_slug (contest_slug)
      ) ENGINE=InnoDB
    `);
    console.log("✓ ContestLeaderboardSnapshots created.");

    console.log("All contest tables successfully created on TiDB!");
  } finally {
    conn.release();
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Migration error:", err);
  process.exit(1);
});
