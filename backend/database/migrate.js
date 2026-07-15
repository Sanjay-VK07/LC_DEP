const db = require('../config/db');

async function run() {
  try {
    await db.initializeDatabase();
    
    // 1. Create Schema_Migrations table
    await db.query(`
      CREATE TABLE IF NOT EXISTS Schema_Migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    // Create Attendance_Migration_Issues Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS Attendance_Migration_Issues (
        id INT AUTO_INCREMENT PRIMARY KEY,
        issue_type VARCHAR(255) NOT NULL,
        table_name VARCHAR(255) NOT NULL,
        record_identifier VARCHAR(255) NOT NULL,
        details TEXT,
        detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    // Create Migration_Health Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS Migration_Health (
        migration_name VARCHAR(255) PRIMARY KEY,
        status ENUM('HEALTHY','WARNING','FAILED') NOT NULL DEFAULT 'HEALTHY',
        issues_detected INT DEFAULT 0,
        last_checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    // 2. Check if already executed and healthy
    const rows = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'robust_unrated_contest_support'"
    );
    let isHealthy = false;
    try {
      const healthRow = await db.query(
        "SELECT status FROM Migration_Health WHERE migration_name = 'robust_unrated_contest_support'"
      );
      if (healthRow.length > 0 && healthRow[0].status === 'HEALTHY') {
        isHealthy = true;
      }
    } catch (err) {
      // Might not exist yet on first run
    }

    let runFirstMigration = true;
    if (rows.length > 0) {
      console.log('[Migration] Migration "robust_unrated_contest_support" is already executed. Skipping.');
      runFirstMigration = false;
    }

    if (runFirstMigration) {
      console.log('[Migration] Executing migration "robust_unrated_contest_support"...');

    // 3. Create Contests Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS Contests (
        contest_slug VARCHAR(255) PRIMARY KEY,
        contest_name VARCHAR(255),
        contest_date DATETIME,
        contest_status ENUM('RATED','UNRATED','CANCELLED'),
        source VARCHAR(50) DEFAULT 'ENTRANTHUB',
        last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_contest_date (contest_date),
        INDEX idx_contest_status (contest_status)
      ) ENGINE=InnoDB;
    `);

    // Ensure source and last_synced_at exist in Contests (for upgrades)
    const contestColumns = await db.query("SHOW COLUMNS FROM Contests");
    const contestColNames = contestColumns.map(c => c.Field);
    if (!contestColNames.includes('source')) {
      console.log('[Migration] Adding source to Contests...');
      await db.query("ALTER TABLE Contests ADD COLUMN source VARCHAR(50) DEFAULT 'ENTRANTHUB' AFTER contest_status;");
    }
    if (!contestColNames.includes('last_synced_at')) {
      console.log('[Migration] Adding last_synced_at to Contests...');
      await db.query("ALTER TABLE Contests ADD COLUMN last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER source;");
    }

    // 4. Create Contest_Participants Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS Contest_Participants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contest_slug VARCHAR(255),
        leetcode_username VARCHAR(255),
        contest_rank INT,
        contest_score DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_participant (contest_slug, leetcode_username),
        INDEX idx_participant_username (leetcode_username),
        INDEX idx_participant_contest (contest_slug)
      ) ENGINE=InnoDB;
    `);

    // 5. Add columns to Contest_Attendance
    const columns = await db.query("SHOW COLUMNS FROM Contest_Attendance");
    const colNames = columns.map(c => c.Field);

    if (!colNames.includes('contest_slug')) {
      console.log('[Migration] Adding contest_slug to Contest_Attendance...');
      await db.query("ALTER TABLE Contest_Attendance ADD COLUMN contest_slug VARCHAR(255) AFTER contest_name;");
    }
    if (!colNames.includes('contest_status')) {
      console.log('[Migration] Adding contest_status to Contest_Attendance...');
      await db.query("ALTER TABLE Contest_Attendance ADD COLUMN contest_status ENUM('RATED','UNRATED','CANCELLED') DEFAULT 'RATED' AFTER contest_date;");
    }
    if (!colNames.includes('attendance_status')) {
      console.log('[Migration] Adding attendance_status to Contest_Attendance...');
      await db.query("ALTER TABLE Contest_Attendance ADD COLUMN attendance_status ENUM('PRESENT','ABSENT','NOT_APPLICABLE') DEFAULT 'ABSENT' AFTER contest_status;");
    }
    if (!colNames.includes('attendance_source')) {
      console.log('[Migration] Adding attendance_source to Contest_Attendance...');
      await db.query("ALTER TABLE Contest_Attendance ADD COLUMN attendance_source ENUM('AUTO','MANUAL') DEFAULT 'AUTO' AFTER attendance_status;");
    }
    if (!colNames.includes('participation_verified')) {
      console.log('[Migration] Adding participation_verified to Contest_Attendance...');
      await db.query("ALTER TABLE Contest_Attendance ADD COLUMN participation_verified BOOLEAN DEFAULT FALSE AFTER attendance_source;");
    }
    if (!colNames.includes('verification_method')) {
      console.log('[Migration] Adding verification_method to Contest_Attendance...');
      await db.query("ALTER TABLE Contest_Attendance ADD COLUMN verification_method ENUM('RATING_HISTORY','PARTICIPANT_CACHE','RANKING_API','MANUAL') AFTER participation_verified;");
    }
    if (!colNames.includes('score')) {
      console.log('[Migration] Adding score to Contest_Attendance...');
      await db.query("ALTER TABLE Contest_Attendance ADD COLUMN score DECIMAL(10,2) DEFAULT NULL AFTER `rank`;");
    }

    // Add indexes to Contest_Attendance
    try {
      await db.query("ALTER TABLE Contest_Attendance ADD INDEX idx_student_contest_slug (student_id, contest_slug);");
    } catch (err) {
      // Index might already exist
    }
    try {
      await db.query("ALTER TABLE Contest_Attendance ADD INDEX idx_attendance_status (attendance_status);");
    } catch (err) {
      // Index might already exist
    }
    try {
      await db.query("ALTER TABLE Contest_Attendance ADD INDEX idx_contest_status (contest_status);");
    } catch (err) {
      // Index might already exist
    }

    // 6. Add columns and indexes to Contest_Summary
    const summaryCols = await db.query("SHOW COLUMNS FROM Contest_Summary");
    const summaryColNames = summaryCols.map(c => c.Field);

    if (!summaryColNames.includes('rated_contests')) {
      console.log('[Migration] Adding rated_contests to Contest_Summary...');
      await db.query("ALTER TABLE Contest_Summary ADD COLUMN rated_contests INT DEFAULT 0 AFTER total_contests;");
    }
    if (!summaryColNames.includes('unrated_contests')) {
      console.log('[Migration] Adding unrated_contests to Contest_Summary...');
      await db.query("ALTER TABLE Contest_Summary ADD COLUMN unrated_contests INT DEFAULT 0 AFTER rated_contests;");
    }

    try {
      await db.query("ALTER TABLE Contest_Summary ADD INDEX idx_student_summary (student_id);");
    } catch (err) {
      // Index might already exist
    }

    // 7. Backfill data
    console.log('[Migration] Backfilling data for historical records...');

    // Update contest_slug based on contest_name (convert spaces to dashes and lowercase, clean non-alphanumeric except dashes)
    await db.query(`
      UPDATE Contest_Attendance 
      SET contest_slug = LOWER(REGEXP_REPLACE(REPLACE(contest_name, ' ', '-'), '[^a-zA-Z0-9-]', ''))
      WHERE contest_slug IS NULL OR contest_slug = '';
    `);

    // Populate Contests table
    await db.query(`
      INSERT IGNORE INTO Contests (contest_slug, contest_name, contest_date, contest_status, source, last_synced_at)
      SELECT DISTINCT contest_slug, contest_name, contest_date, 'RATED', 'ENTRANTHUB', CURRENT_TIMESTAMP
      FROM Contest_Attendance
      WHERE contest_slug IS NOT NULL AND contest_slug != '';
    `);

    // Populate Contest_Participants table from Contest_Attendance where participated = 1
    await db.query(`
      INSERT IGNORE INTO Contest_Participants (contest_slug, leetcode_username, contest_rank)
      SELECT DISTINCT ca.contest_slug, s.leetcode_username, ca.rank
      FROM Contest_Attendance ca
      JOIN students s ON ca.student_id = s.id
      WHERE ca.participated = 1 AND ca.contest_slug IS NOT NULL AND ca.contest_slug != '';
    `);

    // Set attendance_status based on participated
    await db.query(`
      UPDATE Contest_Attendance
      SET 
        attendance_status = CASE WHEN participated = 1 THEN 'PRESENT' ELSE 'ABSENT' END,
        participation_verified = CASE WHEN participated = 1 THEN TRUE ELSE FALSE END,
        verification_method = CASE WHEN participated = 1 THEN 'RATING_HISTORY' ELSE NULL END
      WHERE (attendance_status = 'ABSENT' OR attendance_status IS NULL) AND participated = 1;
    `);

    // Populate rated_contests and unrated_contests in Contest_Summary
    await db.query(`
      UPDATE Contest_Summary cs
      SET 
        rated_contests = total_contests,
        unrated_contests = 0
      WHERE (rated_contests = 0 OR rated_contests IS NULL) AND total_contests > 0;
    `);

    // Drop old unique constraint on Contest_Attendance if it exists
    try {
      await db.query("ALTER TABLE Contest_Attendance DROP INDEX unique_student_contest;");
    } catch (err) {
      // Ignore if doesn't exist
    }

    // Create new unique constraint
    try {
      await db.query("ALTER TABLE Contest_Attendance ADD UNIQUE KEY unique_student_contest_slug (student_id, contest_slug);");
    } catch (err) {
      // Ignore if duplicate index
    }

    // 7.5. Clean up and add foreign key constraints for Database Integrity
    console.log('[Migration] Verifying data integrity before applying foreign keys...');

    // A. Detect orphans
    const orphanParticipants = await db.query(`
      SELECT id, contest_slug, leetcode_username 
      FROM Contest_Participants 
      WHERE contest_slug IS NULL OR contest_slug = '' OR contest_slug NOT IN (SELECT contest_slug FROM Contests)
    `);

    const orphanAttendanceContest = await db.query(`
      SELECT id, student_id, contest_slug, contest_name 
      FROM Contest_Attendance 
      WHERE contest_slug IS NULL OR contest_slug = '' OR contest_slug NOT IN (SELECT contest_slug FROM Contests)
    `);

    const orphanAttendanceStudent = await db.query(`
      SELECT id, student_id, contest_slug, contest_name 
      FROM Contest_Attendance 
      WHERE student_id NOT IN (SELECT id FROM students)
    `);

    let issuesCount = 0;
    const issuesList = [];

    // Quarantine Contest_Participants orphans
    for (const row of orphanParticipants) {
      issuesCount++;
      const identifier = `id=${row.id}, contest_slug=${row.contest_slug}, user=${row.leetcode_username}`;
      const details = `Participant cache entry references missing contest_slug: '${row.contest_slug}'`;
      issuesList.push({
        issue_type: 'ORPHAN_PARTICIPANT_CONTEST',
        table_name: 'Contest_Participants',
        record_identifier: identifier,
        details
      });
    }

    // Quarantine Contest_Attendance contest orphans
    for (const row of orphanAttendanceContest) {
      issuesCount++;
      const identifier = `id=${row.id}, student_id=${row.student_id}, contest_slug=${row.contest_slug}`;
      const details = `Attendance record references missing contest_slug: '${row.contest_slug}' (contest_name: '${row.contest_name}')`;
      issuesList.push({
        issue_type: 'ORPHAN_ATTENDANCE_CONTEST',
        table_name: 'Contest_Attendance',
        record_identifier: identifier,
        details
      });
    }

    // Quarantine Contest_Attendance student orphans
    for (const row of orphanAttendanceStudent) {
      issuesCount++;
      const identifier = `id=${row.id}, student_id=${row.student_id}`;
      const details = `Attendance record references missing student_id: '${row.student_id}' (contest_name: '${row.contest_name}')`;
      issuesList.push({
        issue_type: 'ORPHAN_ATTENDANCE_STUDENT',
        table_name: 'Contest_Attendance',
        record_identifier: identifier,
        details
      });
    }

    // Insert detected issues into Attendance_Migration_Issues (prevent duplicates using record_identifier)
    for (const issue of issuesList) {
      const existing = await db.query(
        "SELECT 1 FROM Attendance_Migration_Issues WHERE record_identifier = ? AND issue_type = ?",
        [issue.record_identifier, issue.issue_type]
      );
      if (existing.length === 0) {
        await db.query(`
          INSERT INTO Attendance_Migration_Issues (issue_type, table_name, record_identifier, details)
          VALUES (?, ?, ?, ?)
        `, [issue.issue_type, issue.table_name, issue.record_identifier, issue.details]);
      }
      console.warn(`[Quarantine] Issue detected: [${issue.table_name}] ${issue.details}`);
    }

    // Initialize or Reset Migration Health Record
    await db.query(`
      INSERT INTO Migration_Health (migration_name, status, issues_detected)
      VALUES ('robust_unrated_contest_support', 'HEALTHY', ?)
      ON DUPLICATE KEY UPDATE status = 'HEALTHY', issues_detected = ?;
    `, [issuesCount, issuesCount]);

    // Let's compute report summary values
    const [totalParticipantsCountResult] = await db.query("SELECT COUNT(*) as count FROM Contest_Participants");
    const [totalAttendanceCountResult] = await db.query("SELECT COUNT(*) as count FROM Contest_Attendance");
    const totalProcessed = (totalParticipantsCountResult ? totalParticipantsCountResult.count : 0) + 
                             (totalAttendanceCountResult ? totalAttendanceCountResult.count : 0);
    const totalIssues = issuesCount;
    const totalSkipped = issuesCount; 
    const totalMigrated = totalProcessed - totalSkipped;

    console.log('[Migration] Attempting to apply foreign key constraints for Database Integrity...');

    // 1. Add fk_participant_contest to Contest_Participants
    try {
      await db.query(`
        ALTER TABLE Contest_Participants
        ADD CONSTRAINT fk_participant_contest
        FOREIGN KEY (contest_slug)
        REFERENCES Contests(contest_slug)
        ON DELETE CASCADE;
      `);
      console.log('[Migration] Successfully created constraint fk_participant_contest.');
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME' || err.message.includes('Duplicate') || err.message.includes('already exists')) {
        console.log('[Migration] Constraint fk_participant_contest already exists.');
      } else {
        console.warn('[Migration] WARNING: Cannot apply fk_participant_contest constraint due to orphan data or other issue:', err.message);
        await db.query(`
          UPDATE Migration_Health 
          SET status = 'WARNING'
          WHERE migration_name = 'robust_unrated_contest_support'
        `);
      }
    }

    // 2. Add fk_attendance_contest to Contest_Attendance
    try {
      await db.query(`
        ALTER TABLE Contest_Attendance
        ADD CONSTRAINT fk_attendance_contest
        FOREIGN KEY (contest_slug)
        REFERENCES Contests(contest_slug)
        ON DELETE CASCADE;
      `);
      console.log('[Migration] Successfully created constraint fk_attendance_contest.');
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME' || err.message.includes('Duplicate') || err.message.includes('already exists')) {
        console.log('[Migration] Constraint fk_attendance_contest already exists.');
      } else {
        console.warn('[Migration] WARNING: Cannot apply fk_attendance_contest constraint due to orphan data or other issue:', err.message);
        await db.query(`
          UPDATE Migration_Health 
          SET status = 'WARNING'
          WHERE migration_name = 'robust_unrated_contest_support'
        `);
      }
    }

    // 3. Replace old anonymous constraint on student_id with fk_attendance_student
    try {
      const constraints = await db.query(`
        SELECT CONSTRAINT_NAME 
        FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'Contest_Attendance' 
          AND COLUMN_NAME = 'student_id' 
          AND REFERENCED_TABLE_NAME = 'students';
      `);

      for (const row of constraints) {
        if (row.CONSTRAINT_NAME !== 'fk_attendance_student') {
          console.log(`[Migration] Dropping existing constraint: ${row.CONSTRAINT_NAME}`);
          await db.query(`ALTER TABLE Contest_Attendance DROP FOREIGN KEY ${row.CONSTRAINT_NAME};`);
        }
      }
    } catch (err) {
      console.warn('[Migration] Warning dropping old student constraint:', err.message);
    }

    try {
      await db.query(`
        ALTER TABLE Contest_Attendance
        ADD CONSTRAINT fk_attendance_student
        FOREIGN KEY (student_id)
        REFERENCES students(id)
        ON DELETE CASCADE;
      `);
      console.log('[Migration] Successfully created constraint fk_attendance_student.');
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME' || err.message.includes('Duplicate') || err.message.includes('already exists')) {
        console.log('[Migration] Constraint fk_attendance_student already exists.');
      } else {
        console.warn('[Migration] WARNING: Cannot apply fk_attendance_student constraint due to orphan data or other issue:', err.message);
        await db.query(`
          UPDATE Migration_Health 
          SET status = 'WARNING'
          WHERE migration_name = 'robust_unrated_contest_support'
        `);
      }
    }

    // Determine final status
    const [finalHealth] = await db.query(
      "SELECT status, issues_detected FROM Migration_Health WHERE migration_name = 'robust_unrated_contest_support'"
    );
    const finalStatus = finalHealth ? finalHealth.status : 'HEALTHY';
    const finalIssuesDetected = finalHealth ? finalHealth.issues_detected : 0;

    // Report Summary
    console.log('======================================================================');
    console.log('                      MIGRATION REPORT SUMMARY                        ');
    console.log('======================================================================');
    console.log(`Total Records Processed : ${totalProcessed}`);
    console.log(`Total Records Migrated  : ${totalMigrated}`);
    console.log(`Total Records Skipped   : ${totalSkipped}`);
    console.log(`Total Issues Detected   : ${totalIssues}`);
    console.log(`Migration Health Status : ${finalStatus} (${finalIssuesDetected} active issues)`);
    console.log('======================================================================');

    // 8. Record migration success in Schema_Migrations
    await db.query(`
      INSERT INTO Schema_Migrations (migration_name) 
      VALUES ('robust_unrated_contest_support')
      ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
    `);

      console.log('[Migration] Migration "robust_unrated_contest_support" completed.');
    }

    // ==========================================
    // MIGRATION 2: attendance_verification_reliability
    // ==========================================
    const rows2 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'attendance_verification_reliability'"
    );
    
    if (rows2.length > 0) {
      console.log('[Migration] Migration "attendance_verification_reliability" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "attendance_verification_reliability"...');
      
      // Alter ENUM of attendance_status
      console.log('[Migration] Modifying attendance_status ENUM...');
      await db.query(`
        ALTER TABLE Contest_Attendance 
        MODIFY COLUMN attendance_status ENUM('PRESENT', 'PRESENT_HISTORY', 'PRESENT_ENTRAHUB', 'PROBABLY_PRESENT', 'ABSENT', 'UNRATED_CONTEST', 'NOT_APPLICABLE') DEFAULT 'ABSENT'
      `);

      // Add new columns to Contest_Attendance
      const columns = await db.query("SHOW COLUMNS FROM Contest_Attendance");
      const colNames = columns.map(c => c.Field);
      
      if (!colNames.includes('confidence_score')) {
        console.log('[Migration] Adding confidence_score to Contest_Attendance...');
        await db.query("ALTER TABLE Contest_Attendance ADD COLUMN confidence_score INT DEFAULT 0 AFTER verification_source;");
      }
      if (!colNames.includes('evidence_history_found')) {
        console.log('[Migration] Adding evidence_history_found to Contest_Attendance...');
        await db.query("ALTER TABLE Contest_Attendance ADD COLUMN evidence_history_found BOOLEAN DEFAULT FALSE AFTER confidence_score;");
      }
      if (!colNames.includes('evidence_ranking_found')) {
        console.log('[Migration] Adding evidence_ranking_found to Contest_Attendance...');
        await db.query("ALTER TABLE Contest_Attendance ADD COLUMN evidence_ranking_found BOOLEAN DEFAULT FALSE AFTER evidence_history_found;");
      }
      if (!colNames.includes('evidence_submissions_found')) {
        console.log('[Migration] Adding evidence_submissions_found to Contest_Attendance...');
        await db.query("ALTER TABLE Contest_Attendance ADD COLUMN evidence_submissions_found BOOLEAN DEFAULT FALSE AFTER evidence_ranking_found;");
      }
      if (!colNames.includes('evidence_rating_updated')) {
        console.log('[Migration] Adding evidence_rating_updated to Contest_Attendance...');
        await db.query("ALTER TABLE Contest_Attendance ADD COLUMN evidence_rating_updated BOOLEAN DEFAULT FALSE AFTER evidence_submissions_found;");
      }
      if (!colNames.includes('evidence_entrahub_verified')) {
        console.log('[Migration] Adding evidence_entrahub_verified to Contest_Attendance...');
        await db.query("ALTER TABLE Contest_Attendance ADD COLUMN evidence_entrahub_verified BOOLEAN DEFAULT FALSE AFTER evidence_rating_updated;");
      }

      // Record migration execution
      await db.query(`
        INSERT INTO Schema_Migrations (migration_name) 
        VALUES ('attendance_verification_reliability')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "attendance_verification_reliability" completed.');
    }

    // ==========================================
    // MIGRATION 3: enthrahub_platform_transition
    // ==========================================
    const rows3 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'enthrahub_platform_transition'"
    );

    if (rows3.length > 0) {
      console.log('[Migration] Migration "enthrahub_platform_transition" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "enthrahub_platform_transition"...');

      // Drop foreign keys referencing Contests(contest_slug) first
      console.log('[Migration] Dropping foreign keys referencing Contests...');
      try {
        await db.query("ALTER TABLE Contest_Attendance DROP FOREIGN KEY fk_attendance_contest");
      } catch (err) {}
      try {
        await db.query("ALTER TABLE Contest_Participants DROP FOREIGN KEY fk_participant_contest");
      } catch (err) {}

      // Alter Contests table
      console.log('[Migration] Restructuring Contests table...');
      try {
        await db.query(`
          ALTER TABLE Contests 
          DROP PRIMARY KEY,
          ADD COLUMN contest_id INT AUTO_INCREMENT PRIMARY KEY,
          CHANGE COLUMN contest_slug slug VARCHAR(255) NOT NULL,
          CHANGE COLUMN contest_name title VARCHAR(255) NOT NULL,
          CHANGE COLUMN contest_date start_time DATETIME NOT NULL,
          ADD COLUMN contest_type ENUM('Weekly','Biweekly') NOT NULL DEFAULT 'Weekly',
          ADD COLUMN contest_number INT NOT NULL DEFAULT 0,
          ADD COLUMN duration INT DEFAULT NULL,
          ADD COLUMN total_problems INT DEFAULT 4
        `);
      } catch (err) {
        console.error('[Migration Error] Failed to alter Contests columns:', err.message);
      }

      try {
        await db.query("ALTER TABLE Contests MODIFY COLUMN contest_status ENUM('Rated','Unrated') DEFAULT 'Rated'");
      } catch (err) {}

      try {
        await db.query("ALTER TABLE Contests ADD UNIQUE KEY unique_slug (slug)");
      } catch (err) {}

      // 1. Get current tables
      const tables = await db.query("SHOW TABLES");
      const tableNames = tables.map(t => Object.values(t)[0].toLowerCase());

      // 2. Rename students to Users
      if (tableNames.includes('students') && !tableNames.includes('users')) {
        console.log('[Migration] Renaming table students to Users...');
        await db.query("RENAME TABLE students TO Users");
      }

      // 3. Create Registrations table
      console.log('[Migration] Creating table Registrations...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS Registrations (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          contest_id INT NOT NULL,
          registration_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_user_contest_reg (user_id, contest_id)
        ) ENGINE=InnoDB;
      `);

      // 4. Create ParticipationLogs table
      console.log('[Migration] Creating table ParticipationLogs...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS ParticipationLogs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          contest_id INT NOT NULL,
          join_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          participation_status VARCHAR(50) DEFAULT 'JOINED',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_user_contest_part (user_id, contest_id)
        ) ENGINE=InnoDB;
      `);

      // 5. Rename Contest_Attendance to AttendanceRecords
      if (tableNames.includes('contest_attendance') && !tableNames.includes('attendancerecords')) {
        console.log('[Migration] Renaming Contest_Attendance to AttendanceRecords...');
        await db.query("RENAME TABLE Contest_Attendance TO AttendanceRecords");
      }

      // 6. Rename student_id to user_id in AttendanceRecords
      const attColumns = await db.query("SHOW COLUMNS FROM AttendanceRecords");
      const attColNames = attColumns.map(c => c.Field.toLowerCase());
      if (attColNames.includes('student_id') && !attColNames.includes('user_id')) {
        console.log('[Migration] Renaming student_id to user_id in AttendanceRecords...');
        await db.query("ALTER TABLE AttendanceRecords CHANGE COLUMN student_id user_id INT NOT NULL");
      }

      // 7. Add contest_id to AttendanceRecords
      if (!attColNames.includes('contest_id')) {
        console.log('[Migration] Adding contest_id to AttendanceRecords...');
        await db.query("ALTER TABLE AttendanceRecords ADD COLUMN contest_id INT NULL AFTER user_id");
      }

      // 8. Populate contest_id based on contest_slug
      console.log('[Migration] Mapping contest_slug to contest_id in AttendanceRecords...');
      await db.query(`
        UPDATE AttendanceRecords ar
        JOIN Contests c ON ar.contest_slug = c.slug
        SET ar.contest_id = c.contest_id
        WHERE ar.contest_id IS NULL;
      `);

      // Delete any record that couldn't be matched (to prevent NULL key errors)
      await db.query("DELETE FROM AttendanceRecords WHERE contest_id IS NULL");
      await db.query("ALTER TABLE AttendanceRecords MODIFY COLUMN contest_id INT NOT NULL");

      // 9. Create LeetCodeProfiles table
      console.log('[Migration] Creating table LeetCodeProfiles...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS LeetCodeProfiles (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL UNIQUE,
          current_rating DECIMAL(8,2) DEFAULT 1500.00,
          highest_rating DECIMAL(8,2) DEFAULT 1500.00,
          global_ranking INT DEFAULT NULL,
          problems_solved INT DEFAULT 0,
          contest_history LONGTEXT DEFAULT NULL,
          active_days INT DEFAULT 0,
          submission_calendar JSON DEFAULT NULL,
          badges JSON DEFAULT NULL,
          language_stats JSON DEFAULT NULL,
          topic_stats JSON DEFAULT NULL,
          recent_submissions JSON DEFAULT NULL,
          easy_solved INT DEFAULT 0,
          medium_solved INT DEFAULT 0,
          hard_solved INT DEFAULT 0,
          acceptance_rate DECIMAL(5,2) DEFAULT NULL,
          last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB;
      `);

      // 10. Migrate data to new tables
      console.log('[Migration] Backfilling data to Registrations...');
      await db.query(`
        INSERT IGNORE INTO Registrations (user_id, contest_id, registration_time)
        SELECT user_id, contest_id, CURRENT_TIMESTAMP FROM AttendanceRecords;
      `);

      console.log('[Migration] Backfilling data to ParticipationLogs...');
      await db.query(`
        INSERT IGNORE INTO ParticipationLogs (user_id, contest_id, join_time)
        SELECT user_id, contest_id, CURRENT_TIMESTAMP FROM AttendanceRecords
        WHERE attendance_status IN ('PRESENT', 'PRESENT_HISTORY', 'PRESENT_ENTRAHUB', 'PROBABLY_PRESENT', 'UNRATED_CONTEST');
      `);

      if (tableNames.includes('contest_summary')) {
        console.log('[Migration] Backfilling data to LeetCodeProfiles...');
        await db.query(`
          INSERT IGNORE INTO LeetCodeProfiles (user_id, current_rating, highest_rating, global_ranking, problems_solved)
          SELECT student_id, current_rating, highest_rating, highest_rank, 0 FROM Contest_Summary;
        `);
      }

      // 11. Normalize attendance statuses to PRESENT/ABSENT in AttendanceRecords
      console.log('[Migration] Normalizing attendance_status to PRESENT/ABSENT...');
      await db.query(`
        UPDATE AttendanceRecords
        SET attendance_status = CASE 
          WHEN attendance_status IN ('PRESENT', 'PRESENT_HISTORY', 'PRESENT_ENTRAHUB', 'PROBABLY_PRESENT', 'UNRATED_CONTEST') THEN 'PRESENT'
          ELSE 'ABSENT'
        END;
      `);

      // 12. Modify attendance_status ENUM
      console.log('[Migration] Changing attendance_status column ENUM values to PRESENT/ABSENT...');
      await db.query(`
        ALTER TABLE AttendanceRecords 
        MODIFY COLUMN attendance_status ENUM('PRESENT', 'ABSENT') NOT NULL DEFAULT 'ABSENT'
      `);

      // 13. Drop old unique indexes and foreign keys, and add updated ones
      console.log('[Migration] Rebuilding indexes and constraints...');
      try {
        await db.query("ALTER TABLE AttendanceRecords DROP FOREIGN KEY fk_attendance_student");
      } catch (err) {}
      try {
        await db.query("ALTER TABLE AttendanceRecords DROP FOREIGN KEY fk_attendance_contest");
      } catch (err) {}
      try {
        await db.query("ALTER TABLE AttendanceRecords DROP INDEX unique_student_contest_slug");
      } catch (err) {}

      // Add unique constraint and foreign keys to AttendanceRecords
      await db.query("ALTER TABLE AttendanceRecords ADD UNIQUE KEY unique_user_contest (user_id, contest_id)");
      await db.query("ALTER TABLE AttendanceRecords ADD CONSTRAINT fk_attendance_records_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE");
      await db.query("ALTER TABLE AttendanceRecords ADD CONSTRAINT fk_attendance_records_contest FOREIGN KEY (contest_id) REFERENCES Contests(contest_id) ON DELETE CASCADE");

      // Add foreign keys to Registrations
      await db.query("ALTER TABLE Registrations ADD CONSTRAINT fk_registration_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE");
      await db.query("ALTER TABLE Registrations ADD CONSTRAINT fk_registration_contest FOREIGN KEY (contest_id) REFERENCES Contests(contest_id) ON DELETE CASCADE");

      // Add foreign keys to ParticipationLogs
      await db.query("ALTER TABLE ParticipationLogs ADD CONSTRAINT fk_participation_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE");
      await db.query("ALTER TABLE ParticipationLogs ADD CONSTRAINT fk_participation_contest FOREIGN KEY (contest_id) REFERENCES Contests(contest_id) ON DELETE CASCADE");

      // Add foreign keys to LeetCodeProfiles
      await db.query("ALTER TABLE LeetCodeProfiles ADD CONSTRAINT fk_leetcode_profile_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE");

      // 14. Drop obsolete tables
      console.log('[Migration] Dropping obsolete Contest_Summary and Contest_Participants tables...');
      await db.query("DROP TABLE IF EXISTS Contest_Summary");
      await db.query("DROP TABLE IF EXISTS Contest_Participants");

      // Record migration execution
      await db.query(`
        INSERT INTO Schema_Migrations (migration_name) 
        VALUES ('enthrahub_platform_transition')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "enthrahub_platform_transition" completed.');
    }

    // ==========================================
    // MIGRATION 4: attendance_remarks_and_timestamps
    // ==========================================
    const rows4 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'attendance_remarks_and_timestamps'"
    );

    if (rows4.length > 0) {
      console.log('[Migration] Migration "attendance_remarks_and_timestamps" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "attendance_remarks_and_timestamps"...');
      
      const columns = await db.query("SHOW COLUMNS FROM AttendanceRecords");
      const colNames = columns.map(c => c.Field.toLowerCase());
      
      if (!colNames.includes('remarks')) {
        console.log('[Migration] Adding remarks to AttendanceRecords...');
        await db.query("ALTER TABLE AttendanceRecords ADD COLUMN remarks TEXT DEFAULT NULL AFTER attendance_source;");
      }
      if (!colNames.includes('last_updated')) {
        console.log('[Migration] Adding last_updated to AttendanceRecords...');
        await db.query("ALTER TABLE AttendanceRecords ADD COLUMN last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER remarks;");
      }

      await db.query(`
        INSERT INTO Schema_Migrations (migration_name) 
        VALUES ('attendance_remarks_and_timestamps')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "attendance_remarks_and_timestamps" completed.');
    }

    // ==========================================
    // MIGRATION 5: notification_foreign_key_fix
    // ==========================================
    const rows5 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'notification_foreign_key_fix'"
    );

    if (rows5.length > 0) {
      console.log('[Migration] Migration "notification_foreign_key_fix" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "notification_foreign_key_fix"...');
      
      // Drop old foreign key constraint
      try {
        await db.query("ALTER TABLE notifications DROP FOREIGN KEY notifications_ibfk_1");
        console.log('[Migration] Dropped constraint notifications_ibfk_1.');
      } catch (err) {
        console.log('[Migration] Note: failed to drop notifications_ibfk_1 (it might not exist):', err.message);
      }

      // Add new foreign key constraint referencing Users(id)
      try {
        await db.query("ALTER TABLE notifications ADD CONSTRAINT fk_notifications_user FOREIGN KEY (student_id) REFERENCES Users(id) ON DELETE CASCADE");
        console.log('[Migration] Added constraint fk_notifications_user referencing Users(id).');
      } catch (err) {
        console.error('[Migration] Failed to add constraint fk_notifications_user:', err.message);
        throw err;
      }

      await db.query(`
        INSERT INTO Schema_Migrations (migration_name) 
        VALUES ('notification_foreign_key_fix')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "notification_foreign_key_fix" completed.');
    }

    // ==========================================
    // MIGRATION 6: dynamic_department_management
    // ==========================================
    const rows6 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'dynamic_department_management'"
    );

    if (rows6.length > 0) {
      console.log('[Migration] Migration "dynamic_department_management" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "dynamic_department_management"...');

      // 1. Create departments table
      console.log('[Migration] Creating departments table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS departments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(150) NOT NULL,
          code VARCHAR(50) NOT NULL UNIQUE,
          status ENUM('active', 'inactive') DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_dept_code (code)
        ) ENGINE=InnoDB;
      `);

      // 2. Seed initial 12 departments
      console.log('[Migration] Seeding initial departments...');
      await db.query(`
        INSERT IGNORE INTO departments (code, name, status) VALUES
        ('CSE', 'Computer Science Engineering', 'active'),
        ('CSBS', 'Computer Science & Business Systems', 'active'),
        ('AIDS', 'Artificial Intelligence & Data Science', 'active'),
        ('AIML', 'Artificial Intelligence & Machine Learning', 'active'),
        ('CYBER', 'Cyber Security', 'active'),
        ('IT', 'Information Technology', 'active'),
        ('ECE', 'Electronics & Communication Engineering', 'active'),
        ('EEE', 'Electrical & Electronics Engineering', 'active'),
        ('BME', 'Biomedical Engineering', 'active'),
        ('MECH', 'Mechanical Engineering', 'active'),
        ('CIVIL', 'Civil Engineering', 'active'),
        ('BIOTECH', 'Biotechnology', 'active')
      `);

      // 3. Scan Users for any other custom/legacy departments and auto-seed them
      console.log('[Migration] Backfilling unique legacy departments from Users...');
      await db.query(`
        INSERT IGNORE INTO departments (code, name, status)
        SELECT DISTINCT department, department, 'active'
        FROM Users
        WHERE department NOT IN (SELECT code FROM departments)
      `);

      // 4. Add Foreign Key constraint to Users table
      console.log('[Migration] Adding foreign key constraint fk_users_department to Users table...');
      try {
        await db.query("ALTER TABLE Users ADD CONSTRAINT fk_users_department FOREIGN KEY (department) REFERENCES departments(code) ON UPDATE CASCADE ON DELETE RESTRICT");
        console.log('[Migration] Foreign key fk_users_department successfully added.');
      } catch (err) {
        if (err.code === 'ER_DUP_KEYNAME' || err.message.includes('Duplicate') || err.message.includes('already exists')) {
          console.log('[Migration] Constraint fk_users_department already exists.');
        } else {
          console.error('[Migration] Failed to add foreign key constraint fk_users_department:', err.message);
          throw err;
        }
      }

      await db.query(`
        INSERT INTO Schema_Migrations (migration_name) 
        VALUES ('dynamic_department_management')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "dynamic_department_management" completed.');
    }

    // ==========================================
    // MIGRATION 7: integrate_multi_platform
    // ==========================================
    const rows7 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'integrate_multi_platform'"
    );

    if (rows7.length > 0) {
      console.log('[Migration] Migration "integrate_multi_platform" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "integrate_multi_platform"...');

      // 1. Add username columns to Users table
      console.log('[Migration] Adding platform username columns to Users table...');
      const userColumns = await db.query("SHOW COLUMNS FROM Users");
      const userColNames = userColumns.map(c => c.Field.toLowerCase());

      if (!userColNames.includes('codechef_username')) {
        await db.query("ALTER TABLE Users ADD COLUMN codechef_username VARCHAR(100) DEFAULT NULL UNIQUE;");
        console.log('[Migration] Added codechef_username column to Users.');
      }
      if (!userColNames.includes('codeforces_username')) {
        await db.query("ALTER TABLE Users ADD COLUMN codeforces_username VARCHAR(100) DEFAULT NULL UNIQUE;");
        console.log('[Migration] Added codeforces_username column to Users.');
      }
      if (!userColNames.includes('hackerrank_username')) {
        await db.query("ALTER TABLE Users ADD COLUMN hackerrank_username VARCHAR(100) DEFAULT NULL UNIQUE;");
        console.log('[Migration] Added hackerrank_username column to Users.');
      }

      // 2. Create CodeChefProfiles table
      console.log('[Migration] Creating CodeChefProfiles table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS CodeChefProfiles (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL UNIQUE,
          current_rating INT DEFAULT NULL,
          highest_rating INT DEFAULT NULL,
          global_ranking INT DEFAULT NULL,
          country_rank INT DEFAULT NULL,
          problems_solved INT DEFAULT 0,
          stars VARCHAR(10) DEFAULT NULL,
          contest_history LONGTEXT DEFAULT NULL,
          last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_codechef_profile_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;
      `);

      // 3. Create CodeforcesProfiles table
      console.log('[Migration] Creating CodeforcesProfiles table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS CodeforcesProfiles (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL UNIQUE,
          current_rating INT DEFAULT NULL,
          highest_rating INT DEFAULT NULL,
          \`rank\` VARCHAR(100) DEFAULT NULL,
          max_rank VARCHAR(100) DEFAULT NULL,
          problems_solved INT DEFAULT 0,
          contest_history LONGTEXT DEFAULT NULL,
          last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_codeforces_profile_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;
      `);

      // 4. Create HackerRankProfiles table
      console.log('[Migration] Creating HackerRankProfiles table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS HackerRankProfiles (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL UNIQUE,
          badges LONGTEXT DEFAULT NULL,
          stars INT DEFAULT 0,
          certificates LONGTEXT DEFAULT NULL,
          problems_solved INT DEFAULT 0,
          last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_hackerrank_profile_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;
      `);

      await db.query(`
        INSERT INTO Schema_Migrations (migration_name) 
        VALUES ('integrate_multi_platform')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "integrate_multi_platform" completed.');
    }

    // ==========================================
    // MIGRATION 8: analytics_infrastructure
    // ==========================================
    const rows8 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'analytics_infrastructure'"
    );

    if (rows8.length > 0) {
      console.log('[Migration] Migration "analytics_infrastructure" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "analytics_infrastructure"...');

      // 1. Create AuditLog table
      await db.query(`
        CREATE TABLE IF NOT EXISTS AuditLog (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          action VARCHAR(100) NOT NULL,
          actor VARCHAR(255) DEFAULT 'SYSTEM',
          target_type VARCHAR(100) DEFAULT NULL,
          target_id VARCHAR(255) DEFAULT NULL,
          details LONGTEXT DEFAULT NULL,
          severity ENUM('INFO','WARNING','ERROR') DEFAULT 'INFO',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_audit_action (action),
          INDEX idx_audit_created (created_at),
          INDEX idx_audit_severity (severity)
        ) ENGINE=InnoDB
      `);
      console.log('[Migration] Created AuditLog table.');

      // 2. Create PlatformHealth table
      await db.query(`
        CREATE TABLE IF NOT EXISTS PlatformHealth (
          platform VARCHAR(50) PRIMARY KEY,
          status VARCHAR(20) DEFAULT 'unknown',
          success_count INT DEFAULT 0,
          failure_count INT DEFAULT 0,
          avg_latency_ms INT DEFAULT 0,
          consecutive_failures INT DEFAULT 0,
          last_success_at TIMESTAMP NULL,
          last_failure_at TIMESTAMP NULL,
          last_error TEXT DEFAULT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
      `);
      console.log('[Migration] Created PlatformHealth table.');

      // 3. Add severity column to notifications (if missing)
      const notifCols = await db.query("SHOW COLUMNS FROM notifications");
      const notifColNames = notifCols.map(c => c.Field.toLowerCase());
      if (!notifColNames.includes('severity')) {
        await db.query("ALTER TABLE notifications ADD COLUMN severity ENUM('INFO','WARNING','CRITICAL') DEFAULT 'INFO' AFTER type");
        console.log('[Migration] Added severity column to notifications.');
      }
      if (!notifColNames.includes('archived')) {
        await db.query("ALTER TABLE notifications ADD COLUMN archived BOOLEAN DEFAULT FALSE AFTER is_read");
        console.log('[Migration] Added archived column to notifications.');
      }
      if (!notifColNames.includes('contest_id')) {
        await db.query("ALTER TABLE notifications ADD COLUMN contest_id INT DEFAULT NULL AFTER student_id");
        console.log('[Migration] Added contest_id column to notifications.');
      }

      // Record migration
      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('analytics_infrastructure')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "analytics_infrastructure" completed.');
    }

    // ==========================================
    // MIGRATION 9: data_validation_and_audit
    // ==========================================
    const rows9 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'data_validation_and_audit'"
    );

    if (rows9.length > 0) {
      console.log('[Migration] Migration "data_validation_and_audit" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "data_validation_and_audit"...');

      // 1. Upgrade AuditLog table
      console.log('[Migration] Upgrading AuditLog table...');
      const auditCols = await db.query("SHOW COLUMNS FROM AuditLog");
      const auditColNames = auditCols.map(c => c.Field.toLowerCase());
      if (!auditColNames.includes('result')) {
        await db.query("ALTER TABLE AuditLog ADD COLUMN result VARCHAR(50) DEFAULT NULL AFTER severity");
      }
      if (!auditColNames.includes('duration_ms')) {
        await db.query("ALTER TABLE AuditLog ADD COLUMN duration_ms INT DEFAULT NULL AFTER result");
      }
      if (!auditColNames.includes('source_platform')) {
        await db.query("ALTER TABLE AuditLog ADD COLUMN source_platform VARCHAR(50) DEFAULT NULL AFTER duration_ms");
      }

      // 2. Create ValidationLogs table
      console.log('[Migration] Creating ValidationLogs table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS ValidationLogs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          platform VARCHAR(50) NOT NULL,
          record_type VARCHAR(100) NOT NULL,
          record_id VARCHAR(255) DEFAULT NULL,
          invalid_data LONGTEXT DEFAULT NULL,
          reason VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
      `);

      // 3. Create AmbiguousContestMatches table
      console.log('[Migration] Creating AmbiguousContestMatches table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS AmbiguousContestMatches (
          id INT AUTO_INCREMENT PRIMARY KEY,
          student_id INT NOT NULL,
          fetched_contest_name VARCHAR(255) NOT NULL,
          matched_contest_id INT NOT NULL,
          confidence_score INT NOT NULL,
          status VARCHAR(20) DEFAULT 'PENDING',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (student_id) REFERENCES Users(id) ON DELETE CASCADE,
          FOREIGN KEY (matched_contest_id) REFERENCES Contests(contest_id) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);

      // 4. Create colleges table
      console.log('[Migration] Creating colleges table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS colleges (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(150) NOT NULL UNIQUE,
          code VARCHAR(50) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
      `);

      // Seed default college
      await db.query(`
        INSERT IGNORE INTO colleges (name, code)
        VALUES ('Default Engineering College', 'DEC')
      `);

      // 5. Add college_code to Users and departments
      console.log('[Migration] Partitioning tables by college_code...');
      const userCols = await db.query("SHOW COLUMNS FROM Users");
      const userColNames = userCols.map(c => c.Field.toLowerCase());
      if (!userColNames.includes('college_code')) {
        await db.query("ALTER TABLE Users ADD COLUMN college_code VARCHAR(50) DEFAULT 'DEC' AFTER id");
        try {
          await db.query("ALTER TABLE Users ADD CONSTRAINT fk_users_college FOREIGN KEY (college_code) REFERENCES colleges(code) ON UPDATE CASCADE ON DELETE RESTRICT");
        } catch (e) {
          console.warn('[Migration] Could not add fk_users_college constraint:', e.message);
        }
      }

      const deptCols = await db.query("SHOW COLUMNS FROM departments");
      const deptColNames = deptCols.map(c => c.Field.toLowerCase());
      if (!deptColNames.includes('college_code')) {
        await db.query("ALTER TABLE departments ADD COLUMN college_code VARCHAR(50) DEFAULT 'DEC' AFTER id");
        try {
          await db.query("ALTER TABLE departments ADD CONSTRAINT fk_depts_college FOREIGN KEY (college_code) REFERENCES colleges(code) ON UPDATE CASCADE ON DELETE RESTRICT");
        } catch (e) {
          console.warn('[Migration] Could not add fk_depts_college constraint:', e.message);
        }
      }

      // 6. Create Accounts table
      console.log('[Migration] Creating Accounts table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS Accounts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          email VARCHAR(150) UNIQUE DEFAULT NULL,
          name VARCHAR(150) DEFAULT NULL,
          role ENUM('Super Admin', 'HOD', 'Faculty', 'Placement Coordinator', 'Student') NOT NULL,
          student_id INT DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (student_id) REFERENCES Users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);

      // 7. Seed default accounts
      const bcrypt = require('bcryptjs');
      const superAdminHash = await bcrypt.hash('admin123', 10);
      const hodHash = await bcrypt.hash('hod123', 10);
      const facultyHash = await bcrypt.hash('faculty123', 10);
      const placementHash = await bcrypt.hash('placement123', 10);

      await db.query(`
        INSERT IGNORE INTO Accounts (username, password_hash, role, name, email)
        VALUES 
          ('admin', ?, 'Super Admin', 'System Administrator', 'admin@college.edu'),
          ('hod', ?, 'HOD', 'Head of Department', 'hod@college.edu'),
          ('faculty', ?, 'Faculty', 'Faculty Coordinator', 'faculty@college.edu'),
          ('placement', ?, 'Placement Coordinator', 'Placement Officer', 'placement@college.edu')
      `, [superAdminHash, hodHash, facultyHash, placementHash]);

      // Seed Student accounts based on existing Users table
      console.log('[Migration] Seeding Student accounts...');
      const existingUsers = await db.query("SELECT id, name, roll_no FROM Users");
      for (const u of existingUsers) {
        const studentHash = await bcrypt.hash(u.roll_no, 10); // default password is roll number
        await db.query(`
          INSERT IGNORE INTO Accounts (username, password_hash, role, name, student_id)
          VALUES (?, ?, 'Student', ?, ?)
        `, [u.roll_no, studentHash, u.name, u.id]);
      }

      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('data_validation_and_audit')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "data_validation_and_audit" completed.');
    }

    // ==========================================================
    // MIGRATION 10: enterprise_contest_attendance_tracker
    // ==========================================================
    const rows10 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'enterprise_contest_attendance_tracker'"
    );

    if (rows10.length > 0) {
      console.log('[Migration] Migration "enterprise_contest_attendance_tracker" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "enterprise_contest_attendance_tracker"...');

      // 1. Create LiveContests table
      await db.query(`
        CREATE TABLE IF NOT EXISTS LiveContests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          platform ENUM('LeetCode', 'CodeChef', 'Codeforces', 'AtCoder') NOT NULL,
          contestSlug VARCHAR(255) UNIQUE NOT NULL,
          contestName VARCHAR(255) NOT NULL,
          contestType VARCHAR(100) NOT NULL,
          startTime DATETIME NOT NULL,
          endTime DATETIME NOT NULL,
          status ENUM('Upcoming', 'Live', 'Synchronizing', 'Completed', 'Archived') NOT NULL DEFAULT 'Upcoming',
          lastSyncAt TIMESTAMP NULL DEFAULT NULL,
          totalParticipants INT DEFAULT 0,
          syncProgress DECIMAL(5,2) DEFAULT 0.00,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_live_contests_status (status),
          INDEX idx_live_contests_slug (contestSlug)
        ) ENGINE=InnoDB;
      `);
      console.log('[Migration] Created LiveContests table.');

      // 2. Create ContestAttendance table
      await db.query(`
        CREATE TABLE IF NOT EXISTS ContestAttendance (
          id INT AUTO_INCREMENT PRIMARY KEY,
          contestId INT NOT NULL,
          studentId INT NOT NULL,
          username VARCHAR(100) NOT NULL,
          attendanceStatus ENUM('Unknown', 'Participating', 'Present', 'Absent') NOT NULL DEFAULT 'Unknown',
          \`rank\` INT DEFAULT NULL,
          solved INT DEFAULT 0,
          score DECIMAL(10,2) DEFAULT 0.00,
          penalty INT DEFAULT 0,
          ratingBefore DECIMAL(8,3) DEFAULT NULL,
          ratingAfter DECIMAL(8,3) DEFAULT NULL,
          ratingChange DECIMAL(8,3) DEFAULT NULL,
          firstDetectedAt TIMESTAMP NULL DEFAULT NULL,
          lastUpdatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_student_live_contest (studentId, contestId),
          INDEX idx_attendance_contest_student (contestId, studentId),
          INDEX idx_attendance_status (attendanceStatus),
          INDEX idx_attendance_updated (lastUpdatedAt),
          CONSTRAINT fk_attendance_live_contest FOREIGN KEY (contestId) REFERENCES LiveContests(id) ON DELETE CASCADE,
          CONSTRAINT fk_attendance_live_student FOREIGN KEY (studentId) REFERENCES Users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;
      `);
      console.log('[Migration] Created ContestAttendance table.');

      // 3. Create ContestSnapshots table
      await db.query(`
        CREATE TABLE IF NOT EXISTS ContestSnapshots (
          id INT AUTO_INCREMENT PRIMARY KEY,
          contestId INT NOT NULL,
          snapshotTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          participants INT DEFAULT 0,
          attendancePercentage DECIMAL(5,2) DEFAULT 0.00,
          averageSolved DECIMAL(5,2) DEFAULT 0.00,
          highestRank INT DEFAULT NULL,
          averageRank DECIMAL(10,2) DEFAULT NULL,
          INDEX idx_snapshots_contest (contestId),
          CONSTRAINT fk_snapshots_live_contest FOREIGN KEY (contestId) REFERENCES LiveContests(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;
      `);
      console.log('[Migration] Created ContestSnapshots table.');

      // 4. Create ContestSyncLog table
      await db.query(`
        CREATE TABLE IF NOT EXISTS ContestSyncLog (
          id INT AUTO_INCREMENT PRIMARY KEY,
          contestId INT NOT NULL,
          syncStarted DATETIME NOT NULL,
          syncCompleted DATETIME NULL DEFAULT NULL,
          pagesFetched INT DEFAULT 0,
          participantsFetched INT DEFAULT 0,
          errors TEXT DEFAULT NULL,
          duration INT DEFAULT NULL,
          INDEX idx_sync_log_contest (contestId),
          CONSTRAINT fk_sync_log_live_contest FOREIGN KEY (contestId) REFERENCES LiveContests(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;
      `);
      console.log('[Migration] Created ContestSyncLog table.');

      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('enterprise_contest_attendance_tracker')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "enterprise_contest_attendance_tracker" completed.');
    }

    // ==========================================================
    // MIGRATION 11: contest_leaderboard_sync_service
    // ==========================================================
    const rows11 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'contest_leaderboard_sync_service'"
    );

    if (rows11.length > 0) {
      console.log('[Migration] Migration "contest_leaderboard_sync_service" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "contest_leaderboard_sync_service"...');

      // 1. Create ContestParticipants table
      await db.query(`
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
          page_number INT NOT NULL,
          synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_contest_username (contest_slug, username),
          INDEX idx_contest_slug (contest_slug),
          INDEX idx_username (username)
        ) ENGINE=InnoDB;
      `);
      console.log('[Migration] Created ContestParticipants table.');

      // 2. Create ContestLeaderboardSnapshots table
      await db.query(`
        CREATE TABLE IF NOT EXISTS ContestLeaderboardSnapshots (
          id INT AUTO_INCREMENT PRIMARY KEY,
          contest_slug VARCHAR(255) NOT NULL,
          page_number INT NOT NULL,
          raw_json LONGTEXT NOT NULL,
          downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_contest_page (contest_slug, page_number),
          INDEX idx_contest_slug (contest_slug)
        ) ENGINE=InnoDB;
      `);
      console.log('[Migration] Created ContestLeaderboardSnapshots table.');

      // 3. Add columns to ContestSyncLog
      const syncLogColumns = await db.query("SHOW COLUMNS FROM ContestSyncLog");
      const syncLogColNames = syncLogColumns.map(c => c.Field.toLowerCase());

      if (!syncLogColNames.includes('contest_slug')) {
        await db.query("ALTER TABLE ContestSyncLog ADD COLUMN contest_slug VARCHAR(255) NULL AFTER contestId");
        console.log('[Migration] Added contest_slug to ContestSyncLog.');
      }
      if (!syncLogColNames.includes('sync_status')) {
        await db.query("ALTER TABLE ContestSyncLog ADD COLUMN sync_status VARCHAR(50) DEFAULT 'RUNNING' AFTER contest_slug");
        console.log('[Migration] Added sync_status to ContestSyncLog.');
      }
      if (!syncLogColNames.includes('last_page_synced')) {
        await db.query("ALTER TABLE ContestSyncLog ADD COLUMN last_page_synced INT DEFAULT 0 AFTER sync_status");
        console.log('[Migration] Added last_page_synced to ContestSyncLog.');
      }
      if (!syncLogColNames.includes('participants_synced')) {
        await db.query("ALTER TABLE ContestSyncLog ADD COLUMN participants_synced INT DEFAULT 0 AFTER last_page_synced");
        console.log('[Migration] Added participants_synced to ContestSyncLog.');
      }
      if (!syncLogColNames.includes('total_requests')) {
        await db.query("ALTER TABLE ContestSyncLog ADD COLUMN total_requests INT DEFAULT 0 AFTER participants_synced");
        console.log('[Migration] Added total_requests to ContestSyncLog.');
      }
      if (!syncLogColNames.includes('failed_requests')) {
        await db.query("ALTER TABLE ContestSyncLog ADD COLUMN failed_requests INT DEFAULT 0 AFTER total_requests");
        console.log('[Migration] Added failed_requests to ContestSyncLog.');
      }
      if (!syncLogColNames.includes('retry_count')) {
        await db.query("ALTER TABLE ContestSyncLog ADD COLUMN retry_count INT DEFAULT 0 AFTER failed_requests");
        console.log('[Migration] Added retry_count to ContestSyncLog.');
      }
      if (!syncLogColNames.includes('started_at')) {
        await db.query("ALTER TABLE ContestSyncLog ADD COLUMN started_at DATETIME NULL AFTER retry_count");
        console.log('[Migration] Added started_at to ContestSyncLog.');
      }
      if (!syncLogColNames.includes('completed_at')) {
        await db.query("ALTER TABLE ContestSyncLog ADD COLUMN completed_at DATETIME NULL AFTER started_at");
        console.log('[Migration] Added completed_at to ContestSyncLog.');
      }

      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('contest_leaderboard_sync_service')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "contest_leaderboard_sync_service" completed.');
    }

    // 11. Entrahub Sync Hardening Migration
    const entrahubHardeningMigration = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'entrahub_sync_hardening'"
    );
    if (entrahubHardeningMigration.length === 0) {
      console.log('[Migration] Applying Entrahub Sync Hardening modifications...');
      
      // 1. Alter LiveContests table to add currentSyncPass column
      const liveContestCols = await db.query("SHOW COLUMNS FROM LiveContests");
      const liveContestColNames = liveContestCols.map(c => c.Field);
      
      if (!liveContestColNames.includes('currentSyncPass')) {
        await db.query("ALTER TABLE LiveContests ADD COLUMN currentSyncPass INT DEFAULT 0 AFTER syncProgress");
        console.log('[Migration] Added currentSyncPass to LiveContests.');
      }
      
      // 2. Alter ContestAttendance table:
      // - Modify attendanceStatus ENUM to include 'Pending', 'Present', 'Absent', 'Verified'
      // - Add verified column
      // - Add syncPass column
      const attendanceCols = await db.query("SHOW COLUMNS FROM ContestAttendance");
      const attendanceColNames = attendanceCols.map(c => c.Field);
      
      await db.query(`
        ALTER TABLE ContestAttendance 
        MODIFY COLUMN attendanceStatus ENUM('Unknown', 'Participating', 'Present', 'Absent', 'Pending', 'Verified') 
        NOT NULL DEFAULT 'Pending'
      `);
      console.log('[Migration] Altered attendanceStatus ENUM in ContestAttendance.');

      if (!attendanceColNames.includes('verified')) {
        await db.query("ALTER TABLE ContestAttendance ADD COLUMN verified TINYINT(1) DEFAULT 0 AFTER ratingChange");
        console.log('[Migration] Added verified to ContestAttendance.');
      }
      
      if (!attendanceColNames.includes('syncPass')) {
        await db.query("ALTER TABLE ContestAttendance ADD COLUMN syncPass INT DEFAULT 0 AFTER verified");
        console.log('[Migration] Added syncPass to ContestAttendance.');
      }
      
      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('entrahub_sync_hardening')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "entrahub_sync_hardening" completed.');
    }

    // ==========================================
    // MIGRATION 13: codechef_schema_hardening
    // ==========================================
    const rows13 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'codechef_schema_hardening'"
    );

    if (rows13.length > 0) {
      console.log('[Migration] Migration "codechef_schema_hardening" is already executed. Skipping.');
    } else {
      console.log('[Migration] Applying CodeChef Schema Hardening modifications...');
      
      const ccCols = await db.query("SHOW COLUMNS FROM CodeChefProfiles");
      const ccColNames = ccCols.map(c => c.Field);
      
      if (!ccColNames.includes('lowest_rating')) {
        await db.query("ALTER TABLE CodeChefProfiles ADD COLUMN lowest_rating INT DEFAULT NULL AFTER highest_rating");
        console.log('[Migration] Added lowest_rating to CodeChefProfiles.');
      }
      
      if (!ccColNames.includes('rating_history')) {
        await db.query("ALTER TABLE CodeChefProfiles ADD COLUMN rating_history LONGTEXT DEFAULT NULL AFTER contest_history");
        console.log('[Migration] Added rating_history to CodeChefProfiles.');
      }
      
      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('codechef_schema_hardening')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "codechef_schema_hardening" completed.');
    }

    // ==========================================
    // MIGRATION 14: codechef_provisional_support
    // ==========================================
    const rows14 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'codechef_provisional_support'"
    );

    if (rows14.length > 0) {
      console.log('[Migration] Migration "codechef_provisional_support" is already executed. Skipping.');
    } else {
      console.log('[Migration] Applying CodeChef Provisional Support modifications...');
      
      const ccCols = await db.query("SHOW COLUMNS FROM CodeChefProfiles");
      const ccColNames = ccCols.map(c => c.Field);
      
      if (!ccColNames.includes('is_provisional')) {
        await db.query("ALTER TABLE CodeChefProfiles ADD COLUMN is_provisional TINYINT(1) DEFAULT 0 AFTER lowest_rating");
        console.log('[Migration] Added is_provisional to CodeChefProfiles.');
      }
      
      if (!ccColNames.includes('status')) {
        await db.query("ALTER TABLE CodeChefProfiles ADD COLUMN status VARCHAR(20) DEFAULT 'UNRATED' AFTER is_provisional");
        console.log('[Migration] Added status to CodeChefProfiles.');
      }
      
      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('codechef_provisional_support')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "codechef_provisional_support" completed.');
    }

    // ==========================================
    // MIGRATION 15: solved_count_and_score_consistency
    // ==========================================
    const rows15 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'solved_count_and_score_consistency'"
    );

    if (rows15.length > 0) {
      console.log('[Migration] Migration "solved_count_and_score_consistency" is already executed. Skipping.');
    } else {
      console.log('[Migration] Applying Solved Count & Score Consistency modifications...');
      
      const cpCols = await db.query("SHOW COLUMNS FROM ContestParticipants");
      const cpColNames = cpCols.map(c => c.Field);
      if (!cpColNames.includes('problems_solved')) {
        await db.query("ALTER TABLE ContestParticipants ADD COLUMN problems_solved INT DEFAULT 0 AFTER score");
        console.log('[Migration] Added problems_solved to ContestParticipants.');
      }
      
      const arCols = await db.query("SHOW COLUMNS FROM AttendanceRecords");
      const arColNames = arCols.map(c => c.Field);
      if (!arColNames.includes('problems_solved')) {
        await db.query("ALTER TABLE AttendanceRecords ADD COLUMN problems_solved INT DEFAULT 0 AFTER score");
        console.log('[Migration] Added problems_solved to AttendanceRecords.');
      }
      
      const cCols = await db.query("SHOW COLUMNS FROM Contests");
      const cColNames = cCols.map(c => c.Field);
      if (!cColNames.includes('total_problems')) {
        await db.query("ALTER TABLE Contests ADD COLUMN total_problems INT DEFAULT 4 AFTER duration");
        console.log('[Migration] Added total_problems to Contests.');
      }
      
      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('solved_count_and_score_consistency')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "solved_count_and_score_consistency" completed.');
    }

    // ==========================================
    // MIGRATION 16: contest_participants_integrity
    // ==========================================
    const rows16 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'contest_participants_integrity'"
    );

    if (rows16.length > 0) {
      console.log('[Migration] Migration "contest_participants_integrity" is already executed. Skipping.');
    } else {
      console.log('[Migration] Applying Contest Participants Integrity (FK to Contests.slug)...');

      // Step 1: Remove any orphaned ContestParticipants rows that have no matching Contests.slug.
      // These are test/orphaned entries that would block the FK creation.
      const orphanedCP = await db.query(`
        SELECT COUNT(*) AS cnt
        FROM ContestParticipants cp
        LEFT JOIN Contests c ON cp.contest_slug = c.slug
        WHERE c.slug IS NULL
      `);
      const orphanCount = orphanedCP[0]?.cnt || 0;
      if (orphanCount > 0) {
        console.log(`[Migration] Removing ${orphanCount} orphaned ContestParticipants rows before applying FK...`);
        await db.query(`
          DELETE cp FROM ContestParticipants cp
          LEFT JOIN Contests c ON cp.contest_slug = c.slug
          WHERE c.slug IS NULL
        `);
      }

      // Step 2: Apply foreign key constraint
      try {
        await db.query(`
          ALTER TABLE ContestParticipants
          ADD CONSTRAINT fk_cp_contest_slug
          FOREIGN KEY (contest_slug)
          REFERENCES Contests(slug)
          ON DELETE CASCADE
        `);
        console.log('[Migration] Successfully created constraint fk_cp_contest_slug on ContestParticipants.');
      } catch (err) {
        if (err.code === 'ER_DUP_KEYNAME' || err.message.includes('Duplicate') || err.message.includes('already exists')) {
          console.log('[Migration] Constraint fk_cp_contest_slug already exists.');
        } else {
          console.warn('[Migration] WARNING: Could not apply fk_cp_contest_slug:', err.message);
        }
      }

      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('contest_participants_integrity')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "contest_participants_integrity" completed.');
    }

    // ==========================================
    // MIGRATION 17: codeforces_verification_persistence
    // ==========================================
    const rows17 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'codeforces_verification_persistence'"
    );

    if (rows17.length > 0) {
      console.log('[Migration] Migration "codeforces_verification_persistence" is already executed. Skipping.');
    } else {
      console.log('[Migration] Applying Codeforces Verification Persistence...');

      // 1. Add columns to Users
      const userCols = await db.query("SHOW COLUMNS FROM Users");
      const userColNames = userCols.map(c => c.Field);

      if (!userColNames.includes('codeforces_username_normalized')) {
        await db.query("ALTER TABLE Users ADD COLUMN codeforces_username_normalized VARCHAR(100) DEFAULT NULL UNIQUE;");
        console.log('[Migration] Added codeforces_username_normalized column to Users.');
      }
      if (!userColNames.includes('codeforces_verified')) {
        await db.query("ALTER TABLE Users ADD COLUMN codeforces_verified TINYINT(1) DEFAULT 0;");
        console.log('[Migration] Added codeforces_verified column to Users.');
      }
      if (!userColNames.includes('codeforces_verified_at')) {
        await db.query("ALTER TABLE Users ADD COLUMN codeforces_verified_at TIMESTAMP NULL DEFAULT NULL;");
        console.log('[Migration] Added codeforces_verified_at column to Users.');
      }
      if (!userColNames.includes('codeforces_verified_source')) {
        await db.query("ALTER TABLE Users ADD COLUMN codeforces_verified_source VARCHAR(50) DEFAULT NULL;");
        console.log('[Migration] Added codeforces_verified_source column to Users.');
      }

      // Populate normalized column for existing codeforces_username records
      await db.query("UPDATE Users SET codeforces_username_normalized = LOWER(TRIM(codeforces_username)) WHERE codeforces_username IS NOT NULL AND codeforces_username_normalized IS NULL;");

      // 2. Add columns to CodeforcesProfiles
      const cfCols = await db.query("SHOW COLUMNS FROM CodeforcesProfiles");
      const cfColNames = cfCols.map(c => c.Field);

      if (!cfColNames.includes('last_profile_sync')) {
        await db.query("ALTER TABLE CodeforcesProfiles ADD COLUMN last_profile_sync TIMESTAMP NULL DEFAULT NULL;");
        console.log('[Migration] Added last_profile_sync column to CodeforcesProfiles.');
      }

      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('codeforces_verification_persistence')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "codeforces_verification_persistence" completed.');
    }

    // ==========================================
    // MIGRATION 18: restore_contests_platform_column
    // ==========================================
    const rows18 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'restore_contests_platform_column'"
    );

    if (rows18.length > 0) {
      console.log('[Migration] Migration "restore_contests_platform_column" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "restore_contests_platform_column"...');

      // Step 1: Inspect Current Schema
      const columnsBefore = await db.query("SHOW COLUMNS FROM Contests");
      console.log('[Migration] Detected schema for Contests before migration:');
      console.log(columnsBefore.map(c => c.Field));

      const colNames = columnsBefore.map(c => c.Field);

      // Step 2: Verify Platform Column
      if (colNames.includes('platform')) {
        console.log('[Migration] Column "platform" already exists. Skipping column addition.');
      } else {
        // Step 3: Add Column
        console.log('[Migration] Adding platform column to Contests...');
        await db.query(`
          ALTER TABLE Contests
          ADD COLUMN platform VARCHAR(50) NOT NULL DEFAULT 'LeetCode' AFTER contest_status
        `);
      }

      // Step 4: Backfill Existing Rows
      console.log('[Migration] Backfilling platform column for existing Contests...');
      await db.query(`
        UPDATE Contests
        SET platform = 'LeetCode'
        WHERE platform IS NULL OR platform = ''
      `);

      // Post-Migration Validation
      const columnsAfter = await db.query("SHOW COLUMNS FROM Contests");
      console.log('[Migration] Detected schema for Contests after migration:');
      console.log(columnsAfter.map(c => c.Field));

      if (!columnsAfter.map(c => c.Field).includes('platform')) {
        throw new Error('Validation Failed: platform column was not successfully added to Contests table.');
      }

      const [nullCountRow] = await db.query(`
        SELECT COUNT(*) AS null_count
        FROM Contests
        WHERE platform IS NULL
      `);
      const nullCount = nullCountRow?.null_count || 0;
      console.log(`[Migration] Contests with NULL platform count: ${nullCount} (Expected: 0)`);
      if (nullCount > 0) {
        throw new Error(`Validation Failed: ${nullCount} Contests have NULL platform value.`);
      }
      // Step 5: Record Migration
      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('restore_contests_platform_column')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "restore_contests_platform_column" completed successfully.');
    }

    // ==========================================
    // MIGRATION 19: add_rating_columns_to_attendance
    // ==========================================
    const rows19 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'add_rating_columns_to_attendance'"
    );

    if (rows19.length > 0) {
      console.log('[Migration] Migration "add_rating_columns_to_attendance" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "add_rating_columns_to_attendance"...');

      // Step 1: Inspect Current Schema
      const columns = await db.query("SHOW COLUMNS FROM AttendanceRecords");
      console.log('[Migration] Detected columns for AttendanceRecords before migration:');
      console.log(columns.map(c => c.Field));

      const colNames = columns.map(c => c.Field);

      // Step 2: Determine missing columns
      const missing = [];
      if (!colNames.includes('rating_before')) missing.push('ADD COLUMN rating_before INT DEFAULT NULL AFTER problems_solved');
      if (!colNames.includes('rating_after')) {
        const afterColumn = colNames.includes('rating_before') ? 'rating_before' : 'problems_solved';
        missing.push(`ADD COLUMN rating_after INT DEFAULT NULL AFTER ${afterColumn}`);
      }
      if (!colNames.includes('rating_change')) {
        let afterColumn = 'problems_solved';
        if (colNames.includes('rating_after')) afterColumn = 'rating_after';
        else if (colNames.includes('rating_before')) afterColumn = 'rating_before';
        missing.push(`ADD COLUMN rating_change INT DEFAULT NULL AFTER ${afterColumn}`);
      }

      // Step 3: Execute ONE ALTER TABLE statement adding all missing columns
      if (missing.length > 0) {
        console.log(`[Migration] Adding missing columns: ${missing.join(', ')}`);
        await db.query(`ALTER TABLE AttendanceRecords ${missing.join(', ')}`);
      } else {
        console.log('[Migration] No rating columns are missing.');
      }

      // Step 4: Verify with DESCRIBE AttendanceRecords
      const describe = await db.query("DESCRIBE AttendanceRecords");
      console.log('[Migration] Detected columns for AttendanceRecords after migration:');
      console.log(describe.map(c => c.Field));

      const finalColNames = describe.map(c => c.Field);
      if (!finalColNames.includes('rating_before') || !finalColNames.includes('rating_after') || !finalColNames.includes('rating_change')) {
        throw new Error('Validation Failed: rating columns were not successfully added to AttendanceRecords table.');
      }

      // Step 5: Insert migration record
      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('add_rating_columns_to_attendance')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "add_rating_columns_to_attendance" completed successfully.');
    }

    // ==========================================
    // MIGRATION 20: add_foreign_key_constraints
    // ==========================================
    const rows20 = await db.query(
      "SELECT 1 FROM Schema_Migrations WHERE migration_name = 'add_foreign_key_constraints'"
    );

    if (rows20.length > 0) {
      console.log('[Migration] Migration "add_foreign_key_constraints" is already executed. Skipping.');
    } else {
      console.log('[Migration] Executing migration "add_foreign_key_constraints"...');

      // 1. Delete orphan ContestParticipants
      console.log('[Migration] Cleaning up orphan ContestParticipants...');
      await db.query(`
        DELETE cp FROM ContestParticipants cp
        LEFT JOIN Contests c ON cp.contest_slug = c.slug
        WHERE c.slug IS NULL
      `);

      // 2. Add foreign key to ContestParticipants
      console.log('[Migration] Adding foreign key constraint to ContestParticipants...');
      try {
        await db.query(`
          ALTER TABLE ContestParticipants 
          ADD CONSTRAINT fk_contest_participants_contest 
          FOREIGN KEY (contest_slug) REFERENCES Contests(slug) ON DELETE CASCADE
        `);
      } catch (err) {
        console.warn('[Migration] Warning adding CP foreign key:', err.message);
      }

      // Step 5: Record Migration
      await db.query(`
        INSERT INTO Schema_Migrations (migration_name)
        VALUES ('add_foreign_key_constraints')
        ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
      `);
      console.log('[Migration] Migration "add_foreign_key_constraints" completed successfully.');
    }

    process.exit(0);
  } catch (err) {
    console.error('[Migration] Migration failed:', err.message);
    process.exit(1);
  }
}

run();

