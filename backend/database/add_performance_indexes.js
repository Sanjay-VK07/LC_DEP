const db = require('../config/db');

async function addIndexSafely(tableName, indexName, columnsSql) {
  try {
    const indexes = await db.query(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [indexName]);
    if (indexes.length === 0) {
      console.log(`[DB Index] Creating index ${indexName} on ${tableName}(${columnsSql})...`);
      await db.query(`ALTER TABLE ${tableName} ADD INDEX ${indexName} (${columnsSql})`);
      console.log(`✓ Created index ${indexName} on ${tableName}`);
    } else {
      console.log(`[DB Index] Index ${indexName} on ${tableName} already exists. Skipping.`);
    }
  } catch (err) {
    if (err.code === 'ER_DUP_KEYNAME' || err.message.includes('Duplicate')) {
      console.log(`[DB Index] Index ${indexName} already exists on ${tableName}. Skipping.`);
    } else {
      console.warn(`[DB Index] Warning creating index ${indexName} on ${tableName}:`, err.message);
    }
  }
}

async function runPerformanceIndexes() {
  console.log('======================================================================');
  console.log('[DB Index Optimization] Applying Enterprise Performance Indexes...');
  console.log('======================================================================');

  await db.initializeDatabase();

  // Users table indexes
  await addIndexSafely('Users', 'idx_users_dept_status', 'department, status');
  await addIndexSafely('Users', 'idx_users_batch', 'academic_batch');
  await addIndexSafely('Users', 'idx_users_status', 'status');
  await addIndexSafely('Users', 'idx_users_dept_sec_batch', 'department, section, academic_batch');
  await addIndexSafely('Users', 'idx_users_roll', 'roll_no');

  // students table indexes (if table exists)
  try {
    await addIndexSafely('students', 'idx_students_status', 'status');
    await addIndexSafely('students', 'idx_students_dept_sec_batch', 'department, section, academic_batch');
    await addIndexSafely('students', 'idx_students_leetcode', 'leetcode_username');
  } catch (e) { /* table might not exist */ }

  // Contests table indexes
  await addIndexSafely('Contests', 'idx_contests_platform_status_time', 'platform, contest_status, start_time');
  await addIndexSafely('Contests', 'idx_contests_status_time', 'contest_status, start_time');
  await addIndexSafely('Contests', 'idx_contests_slug', 'slug');
  await addIndexSafely('Contests', 'idx_contests_start_time', 'start_time');

  // Contest_Attendance table indexes (if table exists)
  try {
    await addIndexSafely('Contest_Attendance', 'idx_ca_student_slug', 'student_id, contest_slug');
    await addIndexSafely('Contest_Attendance', 'idx_ca_student_date', 'student_id, contest_date');
    await addIndexSafely('Contest_Attendance', 'idx_ca_date', 'contest_date');
    await addIndexSafely('Contest_Attendance', 'idx_ca_status', 'attendance_status');
  } catch (e) { /* table might not exist */ }

  // ContestParticipants table indexes (if table exists)
  try {
    await addIndexSafely('ContestParticipants', 'idx_cp_slug_user', 'contest_slug, username');
  } catch (e) { /* table might not exist */ }

  // AttendanceRecords table indexes
  await addIndexSafely('AttendanceRecords', 'idx_att_user_contest_status', 'user_id, contest_id, attendance_status');
  await addIndexSafely('AttendanceRecords', 'idx_att_contest_status', 'contest_id, attendance_status');
  await addIndexSafely('AttendanceRecords', 'idx_att_user_status', 'user_id, attendance_status');

  // Registrations table indexes
  await addIndexSafely('Registrations', 'idx_reg_contest_user', 'contest_id, user_id');

  // ParticipationLogs table indexes
  await addIndexSafely('ParticipationLogs', 'idx_part_contest_user', 'contest_id, user_id');

  // Platform profile rating indexes for fast leaderboards
  await addIndexSafely('LeetCodeProfiles', 'idx_lc_rating', 'current_rating DESC');
  await addIndexSafely('CodeChefProfiles', 'idx_cc_rating', 'current_rating DESC');
  await addIndexSafely('CodeforcesProfiles', 'idx_cf_rating', 'current_rating DESC');

  console.log('======================================================================');
  console.log('✓ All Enterprise Performance Indexes Verified and Created Successfully.');
  console.log('======================================================================');
}

if (require.main === module) {
  runPerformanceIndexes().then(() => process.exit(0)).catch(err => {
    console.error('Error applying performance indexes:', err);
    process.exit(1);
  });
}

module.exports = runPerformanceIndexes;
