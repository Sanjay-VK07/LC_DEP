-- Database schema for Academic Period based LeetCode Contest Attendance Management System

-- Disable foreign key checks to drop everything cleanly
SET FOREIGN_KEY_CHECKS = 0;

-- Drop all old and new tables (case-sensitive matched to creations)
DROP TABLE IF EXISTS archived_students;
DROP TABLE IF EXISTS remarks;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS contest_participation;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS Contest_Summary;
DROP TABLE IF EXISTS Contest_Attendance;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS Contests;
DROP TABLE IF EXISTS Contest_Participants;
DROP TABLE IF EXISTS ContestParticipants;
DROP TABLE IF EXISTS ContestLeaderboardSnapshots;
DROP TABLE IF EXISTS ContestSyncLog;
DROP TABLE IF EXISTS ContestSnapshots;
DROP TABLE IF EXISTS ContestAttendance;
DROP TABLE IF EXISTS LiveContests;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS sync_logs;
DROP TABLE IF EXISTS uploads;
DROP TABLE IF EXISTS Attendance_Migration_Issues;
DROP TABLE IF EXISTS Migration_Health;
DROP TABLE IF EXISTS Schema_Migrations;

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
    academic_batch VARCHAR(50) NOT NULL,
    academic_start_date DATE NOT NULL,
    academic_end_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_leetcode_user (leetcode_username),
    INDEX idx_dept_sec (department, section),
    INDEX idx_batch (academic_batch),
    CONSTRAINT fk_students_department FOREIGN KEY (department) REFERENCES departments(code) ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 2. Contest_Attendance Table (Initial State)
CREATE TABLE Contest_Attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    contest_name VARCHAR(150) NOT NULL,
    contest_date DATE NOT NULL,
    `rank` INT DEFAULT NULL,
    participated TINYINT(1) DEFAULT 0,
    verification_source VARCHAR(50) DEFAULT 'Not Found',
    CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 3. Contest_Summary Table (Initial State)
CREATE TABLE Contest_Summary (
    student_id INT PRIMARY KEY,
    total_contests INT DEFAULT 0,
    attended_contests INT DEFAULT 0,
    missed_contests INT DEFAULT 0,
    attendance_percentage DECIMAL(5,2) DEFAULT 0.00,
    current_rating DECIMAL(8,3) DEFAULT 1500.000,
    highest_rating DECIMAL(8,3) DEFAULT 1500.000,
    highest_rank INT DEFAULT NULL,
    average_rank DECIMAL(10,2) DEFAULT NULL,
    last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    INDEX idx_student_summary (student_id)
) ENGINE=InnoDB;

-- 4. Sync Logs Table
CREATE TABLE sync_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    status VARCHAR(20) NOT NULL,
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
    type VARCHAR(50) NOT NULL,
    student_id INT DEFAULT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    INDEX idx_is_read (is_read)
) ENGINE=InnoDB;
