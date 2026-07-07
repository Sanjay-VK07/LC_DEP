const db = require('../config/db');
const { getAdapter } = require('../services/adapters/AdapterFactory');
const { getUnifiedStudentProfile } = require('../services/platformAnalyticsService');
const { getLeetCodeStats } = require('../services/leetcodeService');
const xlsx = require('xlsx');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Reusable handle validation regex constants
const LEETCODE_REGEX = /^[a-zA-Z0-9_-]{3,30}$/;
const CODEFORCES_REGEX = /^[a-zA-Z0-9_-]{3,24}$/;
const CODECHEF_REGEX = /^[a-zA-Z0-9_]{3,30}$/;
const HACKERRANK_REGEX = /^[a-zA-Z0-9_.-]{3,30}$/;

function validateHandles(leetcode, codechef, codeforces, hackerrank) {
  if (!LEETCODE_REGEX.test(leetcode)) {
    return 'Invalid LeetCode username format.';
  }
  if (codechef && !CODECHEF_REGEX.test(codechef)) {
    return 'Invalid CodeChef username format.';
  }
  if (codeforces && !CODEFORCES_REGEX.test(codeforces)) {
    return 'Invalid Codeforces username format.';
  }
  if (hackerrank && !HACKERRANK_REGEX.test(hackerrank)) {
    return 'Invalid HackerRank username format.';
  }
  return null;
}

// 1. Get all students with search and filtering
async function getStudents(req, res) {
  const { search, department, section, academicBatch, status } = req.query;
  
  let sql = `
    SELECT u.id, u.name, u.roll_no, u.department, u.section, u.leetcode_username, 
           u.codechef_username, u.codeforces_username, u.hackerrank_username,
           u.academic_batch, u.academic_start_date, u.academic_end_date, u.status, u.created_at,
           (SELECT COUNT(*) FROM Registrations r WHERE r.user_id = u.id) AS total_contests,
           (SELECT COUNT(*) FROM ParticipationLogs p WHERE p.user_id = u.id) AS attended_contests,
           (SELECT COUNT(*) FROM Registrations r WHERE r.user_id = u.id) - (SELECT COUNT(*) FROM ParticipationLogs p WHERE p.user_id = u.id) AS missed_contests,
           lp.highest_rating, lp.current_rating, lp.global_ranking AS highest_rank
    FROM Users u
    LEFT JOIN LeetCodeProfiles lp ON u.id = lp.user_id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ' AND u.status = ?';
    params.push(status);
  } else {
    sql += " AND u.status = 'active'"; // default to active
  }

  if (search) {
    sql += ' AND (u.name LIKE ? OR u.roll_no LIKE ? OR u.leetcode_username LIKE ?)';
    const searchParam = `%${search.trim()}%`;
    params.push(searchParam, searchParam, searchParam);
  }

  if (department) {
    sql += ' AND u.department = ?';
    params.push(department);
  }

  if (section) {
    sql += ' AND u.section = ?';
    params.push(section);
  }

  if (academicBatch) {
    sql += ' AND u.academic_batch = ?';
    params.push(academicBatch);
  }

  sql += ' ORDER BY u.roll_no ASC';

  try {
    const students = await db.query(sql, params);
    const enriched = students.map(s => {
      const total = s.total_contests || 0;
      const attended = s.attended_contests || 0;
      return {
        ...s,
        attendance_percentage: total > 0 ? parseFloat(((attended / total) * 100).toFixed(2)) : 100.00
      };
    });
    return res.json({ success: true, count: enriched.length, data: enriched });
  } catch (error) {
    console.error('Error fetching students:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve students' });
  }
}

// Helper to format date for SQL
function formatDateForSql(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

// 2. Add single student
async function addStudent(req, res) {
  const { name, rollNo, department, section, leetcodeUsername, codechefUsername, codeforcesUsername, hackerrankUsername, academicBatch, academicStartDate, academicEndDate } = req.body;

  if (!name || !rollNo || !department || !section || !leetcodeUsername || !academicBatch || !academicStartDate || !academicEndDate) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  if (section.trim() === '') {
    return res.status(400).json({ success: false, message: 'Section cannot be empty.' });
  }

  try {
    // Validate department exists and is active
    const deptCheck = await db.query(
      "SELECT id FROM departments WHERE code = ? AND status = 'active'",
      [department.trim().toUpperCase()]
    );
    if (!deptCheck || deptCheck.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Department '${department}' is either invalid or inactive. Please configure it in Department Management first.` 
      });
    }
    const trimmedRoll = rollNo.trim().toUpperCase();
    const trimmedLC = leetcodeUsername.trim();
    const trimmedChef = codechefUsername ? codechefUsername.trim() : null;
    const trimmedForces = codeforcesUsername ? codeforcesUsername.trim() : null;
    const trimmedRank = hackerrankUsername ? hackerrankUsername.trim() : null;

    // Validation using our validation helper
    const valError = validateHandles(trimmedLC, trimmedChef, trimmedForces, trimmedRank);
    if (valError) {
      return res.status(400).json({ success: false, message: valError });
    }

    // Check duplicates in DB
    const checkRoll = await db.query('SELECT id FROM Users WHERE roll_no = ?', [trimmedRoll]);
    if (checkRoll && checkRoll.length > 0) {
      return res.status(400).json({ success: false, message: 'Roll number already exists.' });
    }

    const checkLC = await db.query('SELECT id FROM Users WHERE leetcode_username = ?', [trimmedLC]);
    if (checkLC && checkLC.length > 0) {
      return res.status(400).json({ success: false, message: 'LeetCode username already registered.' });
    }

    if (trimmedChef) {
      const checkChef = await db.query('SELECT id FROM Users WHERE codechef_username = ?', [trimmedChef]);
      if (checkChef && checkChef.length > 0) {
        return res.status(400).json({ success: false, message: 'CodeChef username already registered.' });
      }
    }
    if (trimmedForces) {
      const checkForces = await db.query('SELECT id FROM Users WHERE codeforces_username = ?', [trimmedForces]);
      if (checkForces && checkForces.length > 0) {
        return res.status(400).json({ success: false, message: 'Codeforces username already registered.' });
      }
    }
    if (trimmedRank) {
      const checkRank = await db.query('SELECT id FROM Users WHERE hackerrank_username = ?', [trimmedRank]);
      if (checkRank && checkRank.length > 0) {
        return res.status(400).json({ success: false, message: 'HackerRank username already registered.' });
      }
    }

    // LeetCode Handle Verification
    console.log(`Verifying LeetCode username: ${trimmedLC}`);
    const verifyResult = await getAdapter('leetcode').getProfile(trimmedLC);
    if (!verifyResult.verified) {
      return res.status(400).json({ 
        success: false, 
        message: verifyResult.message || `LeetCode handle '${trimmedLC}' could not be verified.`
      });
    }

    // CodeChef Handle Verification
    let finalChef = null;
    if (trimmedChef) {
      console.log(`Verifying CodeChef username: ${trimmedChef}`);
      const verifyChef = await getAdapter('codechef').getProfile(trimmedChef);
      if (!verifyChef.verified) {
        return res.status(400).json({ success: false, message: verifyChef.message || `CodeChef handle '${trimmedChef}' could not be verified.` });
      }
      finalChef = verifyChef.username;
    }

    // Codeforces Handle Verification
    let finalForces = null;
    if (trimmedForces) {
      console.log(`Verifying Codeforces username: ${trimmedForces}`);
      const verifyForces = await getAdapter('codeforces').getProfile(trimmedForces);
      if (!verifyForces.verified) {
        return res.status(400).json({ success: false, message: verifyForces.message || `Codeforces handle '${trimmedForces}' could not be verified.` });
      }
      finalForces = verifyForces.username;
    }

    // HackerRank Handle Verification
    let finalRank = null;
    if (trimmedRank) {
      console.log(`Verifying HackerRank username: ${trimmedRank}`);
      const verifyRank = await getAdapter('hackerrank').getProfile(trimmedRank);
      if (!verifyRank.verified) {
        return res.status(400).json({ success: false, message: verifyRank.message || `HackerRank handle '${trimmedRank}' could not be verified.` });
      }
      finalRank = verifyRank.username;
    }

    const sqlStartDate = formatDateForSql(academicStartDate);
    const sqlEndDate = formatDateForSql(academicEndDate);

    // Insert student inside Transaction
    const connection = await db.getPool().getConnection();
    let newStudentId;
    try {
      await connection.beginTransaction();

      const result = await connection.query(
        `INSERT INTO Users (name, roll_no, department, section, leetcode_username, codechef_username, codeforces_username, hackerrank_username, academic_batch, academic_start_date, academic_end_date, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        [name.trim(), trimmedRoll, department.trim(), section.trim().toUpperCase(), verifyResult.username, finalChef, finalForces, finalRank, academicBatch.trim(), sqlStartDate, sqlEndDate]
      );

      newStudentId = result.insertId || result[0]?.insertId;

      // Seed empty LeetCodeProfiles record for the new student
      await connection.query(
        `INSERT INTO LeetCodeProfiles (user_id, current_rating, highest_rating, global_ranking, problems_solved)
         VALUES (?, 1500.00, 1500.00, NULL, 0)`,
        [newStudentId]
      );

      // Seed empty profile records for other platforms
      await connection.query(`INSERT INTO CodeChefProfiles (user_id) VALUES (?)`, [newStudentId]);
      await connection.query(`INSERT INTO CodeforcesProfiles (user_id) VALUES (?)`, [newStudentId]);
      await connection.query(`INSERT INTO HackerRankProfiles (user_id) VALUES (?)`, [newStudentId]);

      await connection.commit();
    } catch (transactionErr) {
      await connection.rollback();
      throw transactionErr;
    } finally {
      connection.release();
    }

    // Trigger historical synchronization in the background
    const { syncStudentPlatform } = require('../utils/scheduler');
    if (verifyResult.username) {
      syncStudentPlatform(newStudentId, 'leetcode', true).catch(err => console.error('[Historical Sync Error] LeetCode:', err.message));
    }
    if (finalChef) {
      syncStudentPlatform(newStudentId, 'codechef', true).catch(err => console.error('[Historical Sync Error] CodeChef:', err.message));
    }
    if (finalForces) {
      syncStudentPlatform(newStudentId, 'codeforces', true).catch(err => console.error('[Historical Sync Error] Codeforces:', err.message));
    }
    if (finalRank) {
      syncStudentPlatform(newStudentId, 'hackerrank', true).catch(err => console.error('[Historical Sync Error] HackerRank:', err.message));
    }

    return res.status(201).json({
      success: true,
      message: 'Student added successfully.',
      data: {
        id: newStudentId,
        name,
        rollNo: trimmedRoll,
        department,
        section,
        leetcodeUsername: verifyResult.username,
        codechefUsername: finalChef,
        codeforcesUsername: finalForces,
        hackerrankUsername: finalRank,
        academicBatch,
        academicStartDate: sqlStartDate,
        academicEndDate: sqlEndDate,
        status: 'active'
      }
    });
  } catch (error) {
    console.error('Error adding student:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

// 3. Edit student
async function editStudent(req, res) {
  const { id } = req.params;
  const { name, rollNo, department, section, leetcodeUsername, codechefUsername, codeforcesUsername, hackerrankUsername, academicBatch, academicStartDate, academicEndDate, status } = req.body;

  if (!name || !rollNo || !department || !section || !leetcodeUsername || !academicBatch || !academicStartDate || !academicEndDate) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  if (section.trim() === '') {
    return res.status(400).json({ success: false, message: 'Section cannot be empty.' });
  }

  try {
    // Validate department exists and is active
    const deptCheck = await db.query(
      "SELECT id FROM departments WHERE code = ? AND status = 'active'",
      [department.trim().toUpperCase()]
    );
    if (!deptCheck || deptCheck.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Department '${department}' is either invalid or inactive. Please configure it in Department Management first.` 
      });
    }
    // Check if student exists
    const currentStudent = await db.query('SELECT * FROM Users WHERE id = ?', [id]);
    if (!currentStudent || currentStudent.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const trimmedRoll = rollNo.trim().toUpperCase();
    const trimmedLC = leetcodeUsername.trim();
    const trimmedChef = codechefUsername ? codechefUsername.trim() : null;
    const trimmedForces = codeforcesUsername ? codeforcesUsername.trim() : null;
    const trimmedRank = hackerrankUsername ? hackerrankUsername.trim() : null;

    // Validation using our validation helper
    const valError = validateHandles(trimmedLC, trimmedChef, trimmedForces, trimmedRank);
    if (valError) {
      return res.status(400).json({ success: false, message: valError });
    }

    // Check duplicate roll number
    const checkRoll = await db.query('SELECT id FROM Users WHERE roll_no = ? AND id != ?', [trimmedRoll, id]);
    if (checkRoll && checkRoll.length > 0) {
      return res.status(400).json({ success: false, message: 'Roll number already in use by another student.' });
    }

    // Check duplicate leetcode username
    const checkLC = await db.query('SELECT id FROM Users WHERE leetcode_username = ? AND id != ?', [trimmedLC, id]);
    if (checkLC && checkLC.length > 0) {
      return res.status(400).json({ success: false, message: 'LeetCode username already in use by another student.' });
    }

    if (trimmedChef) {
      const checkChef = await db.query('SELECT id FROM Users WHERE codechef_username = ? AND id != ?', [trimmedChef, id]);
      if (checkChef && checkChef.length > 0) {
        return res.status(400).json({ success: false, message: 'CodeChef username already in use by another student.' });
      }
    }
    if (trimmedForces) {
      const checkForces = await db.query('SELECT id FROM Users WHERE codeforces_username = ? AND id != ?', [trimmedForces, id]);
      if (checkForces && checkForces.length > 0) {
        return res.status(400).json({ success: false, message: 'Codeforces username already in use by another student.' });
      }
    }
    if (trimmedRank) {
      const checkRank = await db.query('SELECT id FROM Users WHERE hackerrank_username = ? AND id != ?', [trimmedRank, id]);
      if (checkRank && checkRank.length > 0) {
        return res.status(400).json({ success: false, message: 'HackerRank username already in use by another student.' });
      }
    }

    let finalLCUsername = trimmedLC;

    const currentLeetCode = String(currentStudent[0].leetcode_username || '').toLowerCase();
    const currentCodeChef = String(currentStudent[0].codechef_username || '').toLowerCase();
    const currentCodeforces = String(currentStudent[0].codeforces_username || '').toLowerCase();
    const currentHackerRank = String(currentStudent[0].hackerrank_username || '').toLowerCase();

    // Re-verify LeetCode handle only if it changed
    if (currentLeetCode !== trimmedLC.toLowerCase()) {
      console.log(`Re-verifying LeetCode username: ${trimmedLC}`);
      const verifyResult = await getAdapter('leetcode').getProfile(trimmedLC);
      if (!verifyResult.verified) {
        return res.status(400).json({ 
          success: false, 
          message: verifyResult.message || `LeetCode handle '${trimmedLC}' could not be verified.`
        });
      }
      finalLCUsername = verifyResult.username;
    }

    let finalChef = trimmedChef;
    if (trimmedChef && currentCodeChef !== trimmedChef.toLowerCase()) {
      console.log(`Re-verifying CodeChef username: ${trimmedChef}`);
      const verifyChef = await getAdapter('codechef').getProfile(trimmedChef);
      if (!verifyChef.verified) {
        return res.status(400).json({ success: false, message: verifyChef.message || `CodeChef handle '${trimmedChef}' could not be verified.` });
      }
      finalChef = verifyChef.username;
    }

    let finalForces = trimmedForces;
    if (trimmedForces && currentCodeforces !== trimmedForces.toLowerCase()) {
      console.log(`Re-verifying Codeforces username: ${trimmedForces}`);
      const verifyForces = await getAdapter('codeforces').getProfile(trimmedForces);
      if (!verifyForces.verified) {
        return res.status(400).json({ success: false, message: verifyForces.message || `Codeforces handle '${trimmedForces}' could not be verified.` });
      }
      finalForces = verifyForces.username;
    }

    let finalRank = trimmedRank;
    if (trimmedRank && currentHackerRank !== trimmedRank.toLowerCase()) {
      console.log(`Re-verifying HackerRank username: ${trimmedRank}`);
      const verifyRank = await getAdapter('hackerrank').getProfile(trimmedRank);
      if (!verifyRank.verified) {
        return res.status(400).json({ success: false, message: verifyRank.message || `HackerRank handle '${trimmedRank}' could not be verified.` });
      }
      finalRank = verifyRank.username;
    }

    const sqlStartDate = formatDateForSql(academicStartDate);
    const sqlEndDate = formatDateForSql(academicEndDate);

    // Update DB inside transaction
    const connection = await db.getPool().getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `UPDATE Users 
         SET name = ?, roll_no = ?, department = ?, section = ?, leetcode_username = ?, 
             codechef_username = ?, codeforces_username = ?, hackerrank_username = ?,
             academic_batch = ?, academic_start_date = ?, academic_end_date = ?, status = ? 
         WHERE id = ?`,
        [name.trim(), trimmedRoll, department.trim(), section.trim().toUpperCase(), finalLCUsername, finalChef, finalForces, finalRank, academicBatch.trim(), sqlStartDate, sqlEndDate, status || 'active', id]
      );

      // Seed missing profile cache tables if they don't exist
      await connection.query(`INSERT IGNORE INTO CodeChefProfiles (user_id) VALUES (?)`, [id]);
      await connection.query(`INSERT IGNORE INTO CodeforcesProfiles (user_id) VALUES (?)`, [id]);
      await connection.query(`INSERT IGNORE INTO HackerRankProfiles (user_id) VALUES (?)`, [id]);

      await connection.commit();
    } catch (transactionErr) {
      await connection.rollback();
      throw transactionErr;
    } finally {
      connection.release();
    }

    // Trigger historical synchronization in the background for changed handles
    const { syncStudentPlatform } = require('../utils/scheduler');
    if (finalLCUsername && currentLeetCode !== finalLCUsername.toLowerCase()) {
      syncStudentPlatform(id, 'leetcode', true).catch(err => console.error('[Historical Sync Error] LeetCode:', err.message));
    }
    if (finalChef && currentCodeChef !== finalChef.toLowerCase()) {
      syncStudentPlatform(id, 'codechef', true).catch(err => console.error('[Historical Sync Error] CodeChef:', err.message));
    }
    if (finalForces && currentCodeforces !== finalForces.toLowerCase()) {
      syncStudentPlatform(id, 'codeforces', true).catch(err => console.error('[Historical Sync Error] Codeforces:', err.message));
    }
    if (finalRank && currentHackerRank !== finalRank.toLowerCase()) {
      syncStudentPlatform(id, 'hackerrank', true).catch(err => console.error('[Historical Sync Error] HackerRank:', err.message));
    }

    return res.json({
      success: true,
      message: 'Student updated successfully.'
    });
  } catch (error) {
    console.error('Error updating student:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

// 4. Delete student
async function deleteStudent(req, res) {
  // Defensive RBAC Check
  if (req.user && !['Super Admin', 'Faculty', 'HOD'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions.' });
  }
  const { id } = req.params;

  try {
    const check = await db.query('SELECT id FROM Users WHERE id = ?', [id]);
    if (!check || check.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    await db.query('DELETE FROM Users WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Student deleted successfully.' });
  } catch (error) {
    console.error('Error deleting student:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

// 5. Bulk Import Students from Excel
async function bulkImportStudents(req, res) {
  // Defensive RBAC Check
  if (req.user && !['Super Admin', 'Faculty', 'HOD'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions.' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Please upload an Excel file.' });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    if (data.length === 0) {
      return res.status(400).json({ success: false, message: 'Excel file is empty.' });
    }

    const imported = [];
    const duplicates = [];
    const invalidHandles = [];
    const errors = [];

    // Columns mapping helper: case-insensitive match
    const getVal = (row, fields) => {
      const key = Object.keys(row).find(k => fields.includes(k.toLowerCase().trim().replace(/[\s_-]/g, '')));
      return key ? String(row[key]).trim() : '';
    };

    // Cache all existing active/inactive student usernames and roll numbers to avoid N+1 duplicate queries
    const existingUsers = await db.query(
      "SELECT roll_no, leetcode_username, codechef_username, codeforces_username, hackerrank_username FROM Users"
    );

    const rollNoCache = new Set();
    const lcCache = new Set();
    const chefCache = new Set();
    const forcesCache = new Set();
    const rankCache = new Set();

    existingUsers.forEach(u => {
      if (u.roll_no) rollNoCache.add(u.roll_no.trim().toUpperCase());
      if (u.leetcode_username) lcCache.add(u.leetcode_username.trim().toLowerCase());
      if (u.codechef_username) chefCache.add(u.codechef_username.trim().toLowerCase());
      if (u.codeforces_username) forcesCache.add(u.codeforces_username.trim().toLowerCase());
      if (u.hackerrank_username) rankCache.add(u.hackerrank_username.trim().toLowerCase());
    });

    // Cache all active departments
    const activeDeptsRows = await db.query("SELECT code FROM departments WHERE status = 'active'");
    const activeDepts = new Set(activeDeptsRows.map(d => d.code.trim().toUpperCase()));

    // Parallel processing with chunks to avoid rate limits
    const chunkSize = 5;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      
      const promises = chunk.map(async (row, rowIndex) => {
        const globalRowIndex = i + rowIndex + 2; // 1-based, +1 for header
        const rollNo = getVal(row, ['rollno', 'rollnumber', 'regno', 'registernumber', 'register_number']);
        const name = getVal(row, ['studentname', 'name', 'fullname', 'username']);
        const dept = getVal(row, ['department', 'dept', 'branch']);
        const sec = getVal(row, ['section', 'sec', 'class']);
        const academicBatch = getVal(row, ['academicbatch', 'batch', 'academicyear', 'year']);
        const lcUsername = getVal(row, ['leetcodeusername', 'leetcode', 'leetcodehandle', 'handle']);
        const codechefUsername = getVal(row, ['codechefusername', 'codechef', 'codechefhandle']);
        const codeforcesUsername = getVal(row, ['codeforcesusername', 'codeforces', 'codeforceshandle']);
        const hackerrankUsername = getVal(row, ['hackerrankusername', 'hackerrank', 'hackerrankhandle']);
        
        let academicStartDate = getVal(row, ['academicstartdate', 'startdate', 'admissiondate']);
        let academicEndDate = getVal(row, ['academicenddate', 'enddate', 'graduationdate']);

        if (!rollNo || !name || !dept || !sec || !sec.trim() || !academicBatch || !lcUsername) {
          errors.push(`Row ${globalRowIndex}: Missing required fields (Roll No, Name, Dept, Section, Batch, LeetCode Username).`);
          return;
        }

        // Validate department is active in-memory
        if (!activeDepts.has(dept.trim().toUpperCase())) {
          errors.push(`Row ${globalRowIndex}: Department '${dept}' is either invalid or inactive. Please configure it in Department Management first.`);
          return;
        }

        // Default date calculations if not provided in Excel
        if (!academicStartDate && academicBatch) {
          const years = academicBatch.split('-');
          if (years.length >= 1) {
            academicStartDate = `${years[0].trim()}-07-01`;
          }
        }
        if (!academicEndDate && academicBatch) {
          const years = academicBatch.split('-');
          if (years.length >= 2) {
            academicEndDate = `${years[1].trim()}-06-30`;
          }
        }

        if (!academicStartDate || !academicEndDate) {
          errors.push(`Row ${globalRowIndex}: Academic start/end dates could not be resolved.`);
          return;
        }

        const trimmedRoll = rollNo.toUpperCase();
        const trimmedLC = lcUsername.trim();
        const trimmedChef = codechefUsername ? codechefUsername.trim() : null;
        const trimmedForces = codeforcesUsername ? codeforcesUsername.trim() : null;
        const trimmedRank = hackerrankUsername ? hackerrankUsername.trim() : null;

        // Validation using our validation helper
        const valError = validateHandles(trimmedLC, trimmedChef, trimmedForces, trimmedRank);
        if (valError) {
          errors.push(`Row ${globalRowIndex}: ${valError}`);
          return;
        }

        // DB uniqueness checks in-memory
        if (rollNoCache.has(trimmedRoll)) {
          duplicates.push(`Row ${globalRowIndex} (Roll No: ${trimmedRoll}): Roll number already exists.`);
          return;
        }

        if (lcCache.has(trimmedLC.toLowerCase())) {
          duplicates.push(`Row ${globalRowIndex} (LeetCode: ${trimmedLC}): LeetCode username already registered.`);
          return;
        }

        if (trimmedChef && chefCache.has(trimmedChef.toLowerCase())) {
          duplicates.push(`Row ${globalRowIndex} (CodeChef: ${trimmedChef}): CodeChef username already registered.`);
          return;
        }
        if (trimmedForces && forcesCache.has(trimmedForces.toLowerCase())) {
          duplicates.push(`Row ${globalRowIndex} (Codeforces: ${trimmedForces}): Codeforces username already registered.`);
          return;
        }
        if (trimmedRank && rankCache.has(trimmedRank.toLowerCase())) {
          duplicates.push(`Row ${globalRowIndex} (HackerRank: ${trimmedRank}): HackerRank username already registered.`);
          return;
        }

        // LeetCode verification
        const verifyResult = await getAdapter('leetcode').getProfile(trimmedLC);
        if (!verifyResult.verified) {
          invalidHandles.push(`Row ${globalRowIndex} (LeetCode: ${trimmedLC}): ${verifyResult.message || 'Account could not be verified on LeetCode.'}`);
          return;
        }

        // CodeChef verification
        let finalChef = null;
        if (trimmedChef) {
          const verifyChef = await getAdapter('codechef').getProfile(trimmedChef);
          if (!verifyChef.verified) {
            invalidHandles.push(`Row ${globalRowIndex} (CodeChef: ${trimmedChef}): ${verifyChef.message || 'Account could not be verified on CodeChef.'}`);
            return;
          }
          finalChef = verifyChef.username;
        }

        // Codeforces verification
        let finalForces = null;
        if (trimmedForces) {
          const verifyForces = await getAdapter('codeforces').getProfile(trimmedForces);
          if (!verifyForces.verified) {
            invalidHandles.push(`Row ${globalRowIndex} (Codeforces: ${trimmedForces}): ${verifyForces.message || 'Account could not be verified on Codeforces.'}`);
            return;
          }
          finalForces = verifyForces.username;
        }

        // HackerRank verification
        let finalRank = null;
        if (trimmedRank) {
          const verifyRank = await getAdapter('hackerrank').getProfile(trimmedRank);
          if (!verifyRank.verified) {
            invalidHandles.push(`Row ${globalRowIndex} (HackerRank: ${trimmedRank}): ${verifyRank.message || 'Account could not be verified on HackerRank.'}`);
            return;
          }
          finalRank = verifyRank.username;
        }

        const sqlStartDate = formatDateForSql(academicStartDate);
        const sqlEndDate = formatDateForSql(academicEndDate);

        // Transactional insert for each single student to ensure data consistency
        const connection = await db.getPool().getConnection();
        try {
          await connection.beginTransaction();

          const result = await connection.query(
            `INSERT INTO Users (name, roll_no, department, section, leetcode_username, codechef_username, codeforces_username, hackerrank_username, academic_batch, academic_start_date, academic_end_date, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [name, trimmedRoll, dept, sec.toUpperCase(), verifyResult.username, finalChef, finalForces, finalRank, academicBatch, sqlStartDate, sqlEndDate]
          );

          const newStudentId = result.insertId || result[0]?.insertId;

          // Seed empty LeetCodeProfiles record
          await connection.query(
            `INSERT INTO LeetCodeProfiles (user_id, current_rating, highest_rating, global_ranking, problems_solved)
             VALUES (?, 1500.00, 1500.00, NULL, 0)`,
            [newStudentId]
          );

          // Seed empty profiles for other platforms
          await connection.query(`INSERT INTO CodeChefProfiles (user_id) VALUES (?)`, [newStudentId]);
          await connection.query(`INSERT INTO CodeforcesProfiles (user_id) VALUES (?)`, [newStudentId]);
          await connection.query(`INSERT INTO HackerRankProfiles (user_id) VALUES (?)`, [newStudentId]);

          await connection.commit();

          // Add to caches to prevent subsequent duplicates in the same spreadsheet
          rollNoCache.add(trimmedRoll);
          lcCache.add(verifyResult.username.toLowerCase());
          if (finalChef) chefCache.add(finalChef.toLowerCase());
          if (finalForces) forcesCache.add(finalForces.toLowerCase());
          if (finalRank) rankCache.add(finalRank.toLowerCase());

          // Trigger historical synchronization in the background
          const { syncStudentPlatform } = require('../utils/scheduler');
          if (verifyResult.username) {
            syncStudentPlatform(newStudentId, 'leetcode', true).catch(err => {});
          }
          if (finalChef) {
            syncStudentPlatform(newStudentId, 'codechef', true).catch(err => {});
          }
          if (finalForces) {
            syncStudentPlatform(newStudentId, 'codeforces', true).catch(err => {});
          }
          if (finalRank) {
            syncStudentPlatform(newStudentId, 'hackerrank', true).catch(err => {});
          }

          imported.push({ rollNo: trimmedRoll, name, leetcodeUsername: verifyResult.username });
        } catch (dbErr) {
          await connection.rollback();
          errors.push(`Row ${globalRowIndex}: DB insertion failed - ${dbErr.message}`);
        } finally {
          connection.release();
        }
      });

      await Promise.all(promises);
      // Wait to avoid rate limits
      await sleep(1000);
    }

    return res.json({
      success: true,
      message: `Processed ${data.length} rows. Imported: ${imported.length}, Duplicates: ${duplicates.length}, Invalid Handles: ${invalidHandles.length}, Errors: ${errors.length}`,
      details: {
        importedCount: imported.length,
        duplicates,
        invalidHandles,
        errors
      }
    });
  } catch (error) {
    console.error('Error processing bulk upload:', error);
    return res.status(500).json({ success: false, message: 'Internal server error processing file.' });
  }
}

// 6. Batch Graduated Archive Students
async function archiveStudents(req, res) {
  // Defensive RBAC Check
  if (req.user && !['Super Admin', 'Faculty', 'HOD'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions.' });
  }
  const { department, academicBatch, academicYear, section } = req.body;
  const batch = academicBatch || academicYear;

  if (!department || !batch) {
    return res.status(400).json({ success: false, message: 'Department and Academic Batch are required.' });
  }

  try {
    // Find matching active students
    let sql = "SELECT id FROM Users WHERE department = ? AND academic_batch = ? AND status = 'active'";
    const params = [department, batch];
    if (section) {
      sql += " AND section = ?";
      params.push(section);
    }
    const studentsToArchive = await db.query(sql, params);

    if (studentsToArchive.length === 0) {
      return res.status(404).json({ success: false, message: 'No active students found matching the filters.' });
    }

    const studentIds = studentsToArchive.map(s => s.id);
    
    // Batch Update Status to graduated
    const placeholders = studentIds.map(() => '?').join(',');
    await db.query(
      `UPDATE Users SET status = 'graduated' WHERE id IN (${placeholders})`,
      studentIds
    );

    return res.json({
      success: true,
      message: `Successfully marked ${studentIds.length} students as graduated.`
    });
  } catch (error) {
    console.error('Error archiving students:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

// 7. Restore Graduated Student Records to Active (Supports Batch or Individual)
async function restoreStudents(req, res) {
  // Defensive RBAC Check
  if (req.user && !['Super Admin', 'Faculty', 'HOD'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions.' });
  }
  const { studentId, department, academicBatch, academicYear, section } = req.body;

  try {
    if (studentId) {
      await db.query(
        "UPDATE Users SET status = 'active' WHERE id = ? AND status = 'graduated'",
        [studentId]
      );
      return res.json({
        success: true,
        message: 'Successfully restored student to active state.'
      });
    }

    const batch = academicBatch || academicYear;
    if (!department || !batch) {
      return res.status(400).json({ success: false, message: 'Department and Academic Batch (or Student ID) are required.' });
    }

    let sql = "SELECT id FROM Users WHERE department = ? AND academic_batch = ? AND status = 'graduated'";
    const params = [department, batch];
    if (section) {
      sql += " AND section = ?";
      params.push(section);
    }
    const studentsToRestore = await db.query(sql, params);

    if (studentsToRestore.length === 0) {
      return res.status(404).json({ success: false, message: 'No graduated students found matching the filters.' });
    }

    const studentIds = studentsToRestore.map(s => s.id);

    // Batch Update Status to active
    const placeholders = studentIds.map(() => '?').join(',');
    await db.query(
      `UPDATE Users SET status = 'active' WHERE id IN (${placeholders})`,
      studentIds
    );

    return res.json({
      success: true,
      message: `Successfully restored ${studentIds.length} students to active state.`
    });
  } catch (error) {
    console.error('Error restoring students:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

// 8. Get archived summary (list of graduated batches)
async function getArchivedSummary(req, res) {
  try {
    const summary = await db.query(
      `SELECT department, academic_batch, section, COUNT(id) as student_count
       FROM Users 
       WHERE status = 'graduated'
       GROUP BY department, academic_batch, section`
    );
    return res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Error fetching archived summary:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve graduation history.' });
  }
}

// Check Username Helper
async function checkUsername(req, res) {
  const { username } = req.params;
  try {
    const result = await getAdapter('leetcode').getProfile(username);
    return res.json({ exists: result.verified !== false, username: result.username || username, rating: result.rating, globalRanking: result.rank, error: result.message });
  } catch (err) {
    return res.status(500).json({ exists: false, error: err.message });
  }
}

async function getUnifiedProfileById(req, res) {
  const { id } = req.params;
  const { refresh } = req.query;
  try {
    const student = await db.query('SELECT id, name, roll_no, department, section, academic_batch, leetcode_username, codechef_username, codeforces_username, hackerrank_username FROM Users WHERE id = ?', [id]);
    if (!student || student.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    if (refresh === 'true') {
      const { syncStudentProfiles } = require('../utils/scheduler');
      await syncStudentProfiles(Number(id));
    }

    const profile = await getUnifiedStudentProfile(Number(id));
    const cc = profile?.profiles?.codechef || {};
    const ratingHistory = cc.ratingHistory || [];
    console.log('[AUDIT][CONTROLLER] currentRating =', cc.currentRating, 'highestRating =', cc.highestRating, 'lowestRating =', cc.lowestRating, 'ratingHistory.length =', ratingHistory.length);
    console.log('[AUDIT][API] currentRating =', cc.currentRating, 'highestRating =', cc.highestRating, 'lowestRating =', cc.lowestRating, 'ratingHistory.length =', ratingHistory.length);
    console.log('[AUDIT LOG][Controller] currentRating =', cc.currentRating);
    console.log('[AUDIT LOG][API] Response codechef currentRating =', cc.currentRating);
    return res.json({ success: true, data: profile });
  } catch (error) {
    console.error('====================================================');
    console.error('DETAILED ERROR LOG');
    console.error(`Request URL: ${req.originalUrl}`);
    console.error(`HTTP Method: ${req.method}`);
    console.error(`Student ID: ${id}`);
    console.error(`Controller: studentController.getUnifiedProfileById`);
    console.error(`Original Error: ${error.message}`);
    console.error(`Full Stack Trace:\n${error.stack}`);
    console.error('====================================================');

    return res.status(500).json({
      success: false,
      platform: req.query.platform || 'all',
      message: 'Failed to retrieve unified profile data.'
    });
  }
}

// Get LeetCode Stats By Student ID
async function getLeetCodeStatsById(req, res) {
  const { id } = req.params;
  try {
    // 1. Fetch student info to get username
    const student = await db.query(
      "SELECT leetcode_username FROM Users WHERE id = ?",
      [id]
    );

    if (!student || student.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const { leetcode_username } = student[0];
    
    const stats = await getLeetCodeStats(leetcode_username);
    if (!stats.verified) {
      return res.status(404).json({ success: false, message: stats.message || 'Failed to fetch LeetCode statistics.' });
    }

    return res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching LeetCode stats:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

// Get all unique academic batches from Users table
async function getUniqueBatches(req, res) {
  try {
    const list = await db.query(
      "SELECT DISTINCT academic_batch FROM Users WHERE academic_batch IS NOT NULL AND academic_batch != '' ORDER BY academic_batch DESC"
    );
    const batches = list.map(item => item.academic_batch);
    return res.json({ success: true, data: batches });
  } catch (error) {
    console.error('Error fetching unique batches:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve academic batches.' });
  }
}

// Get all unique sections from Users table with optional filters
async function getUniqueSections(req, res) {
  const { department, academicBatch, status } = req.query;
  let sql = "SELECT DISTINCT section FROM Users WHERE section IS NOT NULL AND section != ''";
  const params = [];
  
  if (department) {
    sql += " AND department = ?";
    params.push(department);
  }
  if (academicBatch) {
    sql += " AND academic_batch = ?";
    params.push(academicBatch);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  
  sql += " ORDER BY section ASC";
  
  try {
    const list = await db.query(sql, params);
    const sections = list.map(item => item.section);
    return res.json({ success: true, data: sections });
  } catch (error) {
    console.error('Error fetching unique sections:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve sections.' });
  }
}

// Check Platform Username Helper
async function checkPlatformUsername(req, res) {
  const { platform, username } = req.params;
  try {
    let result = { verified: false };
    const p = platform.toLowerCase();
    if (['leetcode', 'codechef', 'codeforces', 'hackerrank'].includes(p)) {
      result = await getAdapter(p).getProfile(username);
    } else {
      return res.status(400).json({ success: false, message: 'Invalid platform name.' });
    }
    return res.json({ exists: result.verified !== false, username: result.username || username, rating: result.rating, globalRanking: result.rank, error: result.message });
  } catch (err) {
    return res.status(500).json({ exists: false, error: err.message });
  }
}

async function getStudentsDataHealth(req, res) {
  try {
    // 1. Fetch departments
    const deptRows = await db.query("SELECT code FROM departments WHERE status = 'active'");
    const activeDepts = new Set(deptRows.map(d => d.code.toUpperCase()));

    // 2. Fetch all active students
    const users = await db.query(
      `SELECT id, name, roll_no, department, section, academic_batch, leetcode_username, codechef_username, codeforces_username, hackerrank_username, created_at
       FROM Users
       WHERE status = 'active'`
    );

    // 3. Fetch profiles from all platforms
    const lcRows = await db.query("SELECT user_id, current_rating, problems_solved, last_synced FROM LeetCodeProfiles");
    const ccRows = await db.query("SELECT user_id, current_rating, problems_solved, last_synced FROM CodeChefProfiles");
    const cfRows = await db.query("SELECT user_id, current_rating, problems_solved, last_synced FROM CodeforcesProfiles");
    const hrRows = await db.query("SELECT user_id, problems_solved, last_synced FROM HackerRankProfiles");

    // Fetch all sync state rows
    const syncRows = await db.query(`
      SELECT user_id, platform, username, sync_status, last_successful_sync, last_attempt, retry_count, failure_reason, failure_category, data_completeness, next_retry
      FROM StudentPlatformSync
    `);

    // Map by "user_id:platform"
    const syncMap = new Map(syncRows.map(r => [`${r.user_id}:${r.platform.toLowerCase()}`, r]));

    // Index profiles by user_id
    const lcMap = new Map(lcRows.map(r => [r.user_id, r]));
    const ccMap = new Map(ccRows.map(r => [r.user_id, r]));
    const cfMap = new Map(cfRows.map(r => [r.user_id, r]));
    const hrMap = new Map(hrRows.map(r => [r.user_id, r]));

    // 4. Duplicate checks
    const rollNoCounts = new Map();
    const lcCounts = new Map();
    const ccCounts = new Map();
    const cfCounts = new Map();
    const hrCounts = new Map();

    users.forEach(u => {
      const roll = (u.roll_no || '').trim().toLowerCase();
      const lc = (u.leetcode_username || '').trim().toLowerCase();
      const cc = (u.codechef_username || '').trim().toLowerCase();
      const cf = (u.codeforces_username || '').trim().toLowerCase();
      const hr = (u.hackerrank_username || '').trim().toLowerCase();

      if (roll) rollNoCounts.set(roll, (rollNoCounts.get(roll) || 0) + 1);
      if (lc) lcCounts.set(lc, (lcCounts.get(lc) || 0) + 1);
      if (cc) ccCounts.set(cc, (ccCounts.get(cc) || 0) + 1);
      if (cf) cfCounts.set(cf, (cfCounts.get(cf) || 0) + 1);
      if (hr) hrCounts.set(hr, (hrCounts.get(hr) || 0) + 1);
    });

    let duplicateCount = 0;
    let invalidCount = 0;

    // Platform connections success counters
    const platformStats = {
      leetcode: { total: 0, synced: 0 },
      codechef: { total: 0, synced: 0 },
      codeforces: { total: 0, synced: 0 },
      hackerrank: { total: 0, synced: 0 }
    };

    const studentHealths = users.map(user => {
      const missingFields = [];
      const syncErrors = [];
      let isDuplicate = false;
      let isInvalid = false;

      // Validate core fields
      if (!user.name || !user.name.trim()) { missingFields.push('name'); isInvalid = true; }
      if (!user.roll_no || !user.roll_no.trim()) { missingFields.push('roll_no'); isInvalid = true; }
      if (!user.section || !user.section.trim()) missingFields.push('section');
      if (!user.academic_batch || !user.academic_batch.trim()) missingFields.push('academic_batch');
      if (!user.department || !user.department.trim()) {
        missingFields.push('department');
        isInvalid = true;
      } else if (!activeDepts.has(user.department.toUpperCase())) {
        missingFields.push('invalid_department_mapping');
        isInvalid = true;
      }

      // Check duplicates
      const rVal = (user.roll_no || '').trim().toLowerCase();
      if (rVal && rollNoCounts.get(rVal) > 1) {
        syncErrors.push(`Duplicate Roll Number: ${user.roll_no}`);
        isDuplicate = true;
      }
      
      const checkPlatformDup = (username, platformName, countMap) => {
        const val = (username || '').trim().toLowerCase();
        if (val && countMap.get(val) > 1) {
          syncErrors.push(`Duplicate ${platformName} Handle: ${username}`);
          isDuplicate = true;
        }
      };

      checkPlatformDup(user.leetcode_username, 'LeetCode', lcCounts);
      checkPlatformDup(user.codechef_username, 'CodeChef', ccCounts);
      checkPlatformDup(user.codeforces_username, 'Codeforces', cfCounts);
      checkPlatformDup(user.hackerrank_username, 'HackerRank', hrCounts);

      // Check platform sync status
      const getPlatformStatus = (platformKey, username, profileMap, statObj) => {
        const platLower = platformKey.toLowerCase();
        if (!username || !username.trim()) {
          return { connected: false };
        }
        statObj.total++;
        
        const syncState = syncMap.get(`${user.id}:${platLower}`);
        const profile = profileMap.get(user.id);
        
        if (syncState && (syncState.sync_status === 'Healthy' || syncState.sync_status === 'Partial')) {
          statObj.synced++;
        }
        
        return {
          connected: true,
          username,
          syncStatus: syncState ? syncState.sync_status : 'Never Synced',
          lastSuccessfulSync: syncState ? syncState.last_successful_sync : null,
          lastAttempt: syncState ? syncState.last_attempt : null,
          retryCount: syncState ? syncState.retry_count : 0,
          failureReason: syncState ? syncState.failure_reason : null,
          failureCategory: syncState ? syncState.failure_category : null,
          dataCompleteness: syncState ? syncState.data_completeness : 0,
          nextRetry: syncState ? syncState.next_retry : null,
          problemsSolved: profile ? (profile.problems_solved || 0) : 0,
          currentRating: profile ? (profile.current_rating || 0) : 0
        };
      };

      const connections = {
        leetcode: getPlatformStatus('leetcode', user.leetcode_username, lcMap, platformStats.leetcode),
        codechef: getPlatformStatus('codechef', user.codechef_username, ccMap, platformStats.codechef),
        codeforces: getPlatformStatus('codeforces', user.codeforces_username, cfMap, platformStats.codeforces),
        hackerrank: getPlatformStatus('hackerrank', user.hackerrank_username, hrMap, platformStats.hackerrank)
      };

      if (!user.leetcode_username || !user.leetcode_username.trim()) {
        missingFields.push('leetcode_username (Required)');
      }

      // Calculate health score dynamically
      let score = 100;
      let totalConnected = 0;
      let totalPoints = 0;
      
      Object.entries(connections).forEach(([platName, conn]) => {
        if (conn.connected) {
          totalConnected++;
          if (conn.syncStatus === 'Healthy') {
            totalPoints += 100;
          } else if (conn.syncStatus === 'Partial') {
            totalPoints += conn.dataCompleteness;
          } else {
            totalPoints += 0;
            syncErrors.push(`${platName} profile synchronization status is: ${conn.syncStatus}`);
          }
        }
      });
      
      if (totalConnected > 0) {
        score = Math.round(totalPoints / totalConnected);
      } else {
        score = 0;
        syncErrors.push('No platform accounts connected');
      }

      missingFields.forEach(f => {
        score -= 10;
      });

      // Clamp score
      score = Math.max(0, Math.min(100, score));

      // Health indicator
      let healthIndicator = 'Needs Attention';
      if (score >= 85) healthIndicator = 'Healthy';
      else if (score >= 50) healthIndicator = 'Partial';

      if (isDuplicate) duplicateCount++;
      if (isInvalid) invalidCount++;

      return {
        id: user.id,
        name: user.name,
        rollNo: user.roll_no,
        department: user.department,
        section: user.section,
        batch: user.academic_batch,
        healthScore: score,
        healthIndicator,
        connections,
        missingFields,
        syncErrors,
        createdAt: user.created_at
      };
    });

    // 5. Global statistics calculation
    const totalStudents = studentHealths.length;
    const healthyCount = studentHealths.filter(s => s.healthIndicator === 'Healthy').length;
    const partialCount = studentHealths.filter(s => s.healthIndicator === 'Partial').length;
    const needsAttentionCount = studentHealths.filter(s => s.healthIndicator === 'Needs Attention').length;

    // Platform sync rates
    const getRate = (stat) => stat.total > 0 ? Math.round((stat.synced / stat.total) * 100) : 100;
    const rateLC = getRate(platformStats.leetcode);
    const rateCC = getRate(platformStats.codechef);
    const rateCF = getRate(platformStats.codeforces);
    const rateHR = getRate(platformStats.hackerrank);

    const totalConnections = platformStats.leetcode.total + platformStats.codechef.total + platformStats.codeforces.total + platformStats.hackerrank.total;
    const totalSynced = platformStats.leetcode.synced + platformStats.codechef.synced + platformStats.codeforces.synced + platformStats.hackerrank.synced;
    const overallRate = totalConnections > 0 ? Math.round((totalSynced / totalConnections) * 100) : 100;

    // System Health percentage
    const avgHealthScore = totalStudents > 0 
      ? Math.round(studentHealths.reduce((sum, s) => sum + s.healthScore, 0) / totalStudents)
      : 100;

    const aggregates = {
      totalStudents,
      healthyCount,
      partialCount,
      needsAttentionCount,
      duplicateCount,
      invalidCount,
      platformSyncRate: {
        leetcode: rateLC,
        codechef: rateCC,
        codeforces: rateCF,
        hackerrank: rateHR,
        overall: overallRate
      },
      systemHealthPercentage: avgHealthScore
    };

    return res.json({
      success: true,
      aggregates,
      students: studentHealths
    });
  } catch (error) {
    console.error('Error fetching students data health audit:', error);
    return res.status(500).json({ success: false, message: 'Internal server error during diagnostic audit.' });
  }
}

async function syncStudentPlatformManual(req, res) {
  // Defensive RBAC Check
  if (req.user && !['Super Admin', 'Faculty', 'HOD'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions.' });
  }
  const { id, platform } = req.params;
  try {
    const { syncStudentPlatform } = require('../utils/scheduler');
    const result = await syncStudentPlatform(Number(id), platform, true); // forceSync = true
    if (result.success) {
      return res.json({ success: true, message: `Successfully synchronized ${platform}`, status: result.status, completenessScore: result.completenessScore });
    } else {
      return res.status(500).json({ success: false, message: result.error, category: result.category });
    }
  } catch (err) {
    console.error('[Manual Sync] Error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function forceFullSync(req, res) {
  // Defensive RBAC Check
  if (req.user && !['Super Admin', 'Faculty', 'HOD'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions.' });
  }
  try {
    const { syncAllData } = require('../utils/scheduler');
    syncAllData().catch(err => console.error('[Full Sync Error]', err.message));
    return res.json({ success: true, message: 'Platform-wide synchronization started in background.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function clearCacheManual(req, res) {
  // Defensive RBAC Check
  if (req.user && !['Super Admin', 'Faculty', 'HOD'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions.' });
  }
  try {
    const cache = require('../services/analyticsCacheService');
    cache.invalidateAll();
    return res.json({ success: true, message: 'Analytics and placement cache successfully invalidated.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getStudentsDataHealth,
  syncStudentPlatformManual,
  forceFullSync,
  clearCacheManual,
  getStudents,
  addStudent,
  editStudent,
  deleteStudent,
  bulkImportStudents,
  archiveStudents,
  restoreStudents,
  getArchivedSummary,
  checkUsername,
  checkPlatformUsername,
  getUnifiedProfileById,
  getLeetCodeStatsById,
  getUniqueBatches,
  getUniqueSections
};

