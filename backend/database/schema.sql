-- Database schema for Academic Period based LeetCode Contest Attendance Management System
CREATE DATABASE IF NOT EXISTS leetcode_attendance;
USE leetcode_attendance;

-- Disable foreign key checks to drop everything cleanly
SET FOREIGN_KEY_CHECKS = 0;

-- Drop all old and new tables
DROP TABLE IF EXISTS archived_students;
DROP TABLE IF EXISTS remarks;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS contest_participation;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS Contest_Summary;
DROP TABLE IF EXISTS Contest_Attendance;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS contests;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS sync_logs;
DROP TABLE IF EXISTS uploads;
DROP TABLE IF EXISTS Attendance_Migration_Issues;
DROP TABLE IF EXISTS Migration_Health;

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;

-- 0. Departments Table
CREATE TABLE departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_dept_code (code)
) ENGINE=InnoDB;

-- 1. Students Table
CREATE TABLE students (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    roll_no VARCHAR(50) NOT NULL UNIQUE,
    department VARCHAR(100) NOT NULL,
    section VARCHAR(20) NOT NULL,
    leetcode_username VARCHAR(100) NOT NULL UNIQUE,
    academic_batch VARCHAR(50) NOT NULL, -- e.g., "2024-2028"
    academic_start_date DATE NOT NULL,
    academic_end_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'graduated'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_leetcode_user (leetcode_username),
    INDEX idx_dept_sec (department, section),
    INDEX idx_batch (academic_batch),
    CONSTRAINT fk_students_department FOREIGN KEY (department) REFERENCES departments(code) ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 1.5. Contests Table
CREATE TABLE Contests (
    contest_id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    contest_type ENUM('Weekly','Biweekly') NOT NULL,
    contest_number INT NOT NULL,
    start_time DATETIME NOT NULL,
    duration INT,
    total_problems INT DEFAULT 4,
    contest_status ENUM('Rated','Unrated') DEFAULT 'Rated',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_start_time (start_time)
) ENGINE=InnoDB;

-- 1.6. Contest_Participants Table
CREATE TABLE Contest_Participants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    contest_slug VARCHAR(255) NOT NULL,
    leetcode_username VARCHAR(255) NOT NULL,
    contest_rank INT DEFAULT NULL,
    contest_score DECIMAL(10,2) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_participant (contest_slug, leetcode_username),
    INDEX idx_participant_username (leetcode_username),
    INDEX idx_participant_contest (contest_slug),
    CONSTRAINT fk_participant_contest FOREIGN KEY (contest_slug) REFERENCES Contests(slug) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 2. Contest_Attendance Table
CREATE TABLE Contest_Attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    contest_name VARCHAR(150) NOT NULL,
    contest_slug VARCHAR(255) DEFAULT NULL,
    contest_date DATE NOT NULL,
    contest_status ENUM('RATED','UNRATED','CANCELLED') DEFAULT 'RATED',
    attendance_status ENUM('PRESENT', 'PRESENT_HISTORY', 'PRESENT_ENTRAHUB', 'PROBABLY_PRESENT', 'ABSENT', 'UNRATED_CONTEST', 'NOT_APPLICABLE') DEFAULT 'ABSENT',
    attendance_source ENUM('AUTO','MANUAL') DEFAULT 'AUTO',
    participation_verified BOOLEAN DEFAULT FALSE,
    verification_method ENUM('RATING_HISTORY','PARTICIPANT_CACHE','RANKING_API','MANUAL') DEFAULT NULL,
    verification_source VARCHAR(50) DEFAULT 'Not Found',
    confidence_score INT DEFAULT 0,
    evidence_history_found BOOLEAN DEFAULT FALSE,
    evidence_ranking_found BOOLEAN DEFAULT FALSE,
    evidence_submissions_found BOOLEAN DEFAULT FALSE,
    evidence_rating_updated BOOLEAN DEFAULT FALSE,
    evidence_entrahub_verified BOOLEAN DEFAULT FALSE,
    `rank` INT DEFAULT NULL,
    score DECIMAL(10,2) DEFAULT NULL,
    problems_solved INT DEFAULT 0,
    rating_before DECIMAL(8,3) DEFAULT NULL,
    rating_after DECIMAL(8,3) DEFAULT NULL,
    rating_change DECIMAL(8,3) DEFAULT NULL,
    participated TINYINT(1) DEFAULT 0, -- 0/1 (Backward compatibility)
    remarks TEXT DEFAULT NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    CONSTRAINT fk_attendance_contest FOREIGN KEY (contest_slug) REFERENCES Contests(slug) ON DELETE CASCADE,
    UNIQUE KEY unique_student_contest_slug (student_id, contest_slug),
    INDEX idx_student_contest_slug (student_id, contest_slug),
    INDEX idx_contest_date (contest_date),
    INDEX idx_attendance_status (attendance_status),
    INDEX idx_contest_status (contest_status)
) ENGINE=InnoDB;

-- 3. Contest_Summary Table
CREATE TABLE Contest_Summary (
    student_id INT PRIMARY KEY,
    total_contests INT DEFAULT 0,
    rated_contests INT DEFAULT 0,
    unrated_contests INT DEFAULT 0,
    attended_contests INT DEFAULT 0,
    missed_contests INT DEFAULT 0,
    attendance_percentage DECIMAL(5,2) DEFAULT 0.00,
    highest_rating DECIMAL(8,3) DEFAULT 1500.000,
    current_rating DECIMAL(8,3) DEFAULT 1500.000,
    highest_rank INT DEFAULT NULL,
    average_rank DECIMAL(10,2) DEFAULT NULL,
    last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    INDEX idx_student_summary (student_id)
) ENGINE=InnoDB;

-- 4. Sync Logs Table (Tracking automated crawler status)
CREATE TABLE sync_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    status VARCHAR(20) NOT NULL, -- 'success', 'failed', 'running'
    message TEXT DEFAULT NULL,
    contests_synced INT DEFAULT 0,
    students_processed INT DEFAULT 0,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL
) ENGINE=InnoDB;

-- 5. Notifications Table
CREATE TABLE notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'missed_contest', 'low_attendance', 'new_contest', 'top_performer'
    student_id INT DEFAULT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    INDEX idx_is_read (is_read)
) ENGINE=InnoDB;

-- 6. Attendance_Migration_Issues Table
CREATE TABLE IF NOT EXISTS Attendance_Migration_Issues (
    id INT AUTO_INCREMENT PRIMARY KEY,
    issue_type VARCHAR(255) NOT NULL,
    table_name VARCHAR(255) NOT NULL,
    record_identifier VARCHAR(255) NOT NULL,
    details TEXT DEFAULT NULL,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 7. Migration_Health Table
CREATE TABLE IF NOT EXISTS Migration_Health (
    migration_name VARCHAR(255) PRIMARY KEY,
    status ENUM('HEALTHY','WARNING','FAILED') NOT NULL DEFAULT 'HEALTHY',
    issues_detected INT DEFAULT 0,
    last_checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 8. ContestParticipants Table (Added in Migration 11)
CREATE TABLE IF NOT EXISTS ContestParticipants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    contest_slug VARCHAR(255) NOT NULL,
    username VARCHAR(100) NOT NULL,
    `rank` INT NOT NULL,
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

-- 9. ContestLeaderboardSnapshots Table (Added in Migration 11)
CREATE TABLE IF NOT EXISTS ContestLeaderboardSnapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    contest_slug VARCHAR(255) NOT NULL,
    page_number INT NOT NULL,
    raw_json LONGTEXT NOT NULL,
    downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_contest_page (contest_slug, page_number),
    INDEX idx_contest_slug (contest_slug)
) ENGINE=InnoDB;

