const db = require('../config/db');
const xlsx = require('xlsx');
const leetcode = require('../utils/leetcode');
const { getUserCodeChefStats } = require('../utils/codechef');
const { normalizeBatchToShort } = require('../utils/batchHelper');
const { normalizeUsername } = require('../utils/usernameNormalizer');

// Helper to parse dates timezone-independently
function parseDateOnly(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  let dateStr;
  if (dateInput instanceof Date) {
    const year = dateInput.getFullYear();
    const month = String(dateInput.getMonth() + 1).padStart(2, '0');
    const day = String(dateInput.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
  } else if (typeof dateInput === 'string') {
    dateStr = dateInput.substring(0, 10);
  } else {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
  }
  const parts = dateStr.split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0, 0);
}

function formatDate(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Find username column in sheets
function findUsernameColumn(headers) {
  const targetKeywords = ['username', 'handle', 'leetcode', 'user', 'usernames', 'user name', 'leetcode handle', 'leetcode username'];
  
  for (let header of headers) {
    const cleanHeader = String(header).toLowerCase().trim().replace(/[\s_-]/g, '');
    if (targetKeywords.includes(cleanHeader)) {
      return header;
    }
  }

  for (let header of headers) {
    const cleanHeader = String(header).toLowerCase().trim();
    const matches = targetKeywords.some(kw => cleanHeader.includes(kw));
    if (matches) {
      return header;
    }
  }

  return headers[0];
}

// 1. Process Uploaded Contest CSV/Excel and mark attendance
async function processContestUpload(req, res) {
  const { contestName, contestId, contestDate } = req.body;
  const cName = contestName || contestId;

  if (!cName) {
    return res.status(400).json({ success: false, message: 'Contest name or ID is required.' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Contest ranking file (Excel/CSV) is required.' });
  }

  try {
    let cDateStr = contestDate;
    const contestSlug = cName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    if (!cDateStr) {
      const dateResult = await db.query(
        "SELECT DISTINCT start_time FROM Contests WHERE slug = ? LIMIT 1",
        [contestSlug]
      );
      if (dateResult.length > 0) {
        cDateStr = formatDate(dateResult[0].start_time);
      } else {
        cDateStr = new Date().toISOString().split('T')[0];
      }
    }

    // Look up or insert contest in Contests table
    const contestCheck = await db.query("SELECT contest_id FROM Contests WHERE slug = ?", [contestSlug]);
    let targetContestId;

    if (contestCheck.length > 0) {
      targetContestId = contestCheck[0].contest_id;
    } else {
      const contestType = contestSlug.includes('biweekly') ? 'Biweekly' : 'Weekly';
      const match = contestSlug.match(/contest-(\d+)/);
      const contestNumber = match ? parseInt(match[1], 10) : 0;
      const result = await db.query(`
        INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, contest_status)
        VALUES (?, ?, ?, ?, ?, 'Rated')
      `, [cName, contestSlug, contestType, contestNumber, cDateStr]);
      targetContestId = result.insertId;
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const headers = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = xlsx.utils.encode_cell({ r: range.s.r, c: col });
      const cell = sheet[cellAddress];
      headers.push(cell ? cell.v : `col_${col}`);
    }

    const usernameCol = findUsernameColumn(headers);
    
    // Validate that we actually found the username/handle column
    const hasUsernameHeader = headers.some(h => {
      const clean = String(h).toLowerCase().trim().replace(/[\s_-]/g, '');
      return ['username', 'handle', 'leetcode', 'user', 'usernames', 'user name', 'leetcode handle', 'leetcode username'].includes(clean) ||
             ['username', 'handle', 'leetcode', 'user', 'usernames', 'user name', 'leetcode handle', 'leetcode username'].some(kw => clean.includes(kw));
    });

    if (!hasUsernameHeader) {
      console.warn(`[Upload Validation] No LeetCode username/handle column header found in sheet. Headers found: ${JSON.stringify(headers)}`);
      return res.status(400).json({ 
        success: false, 
        message: "Could not identify a LeetCode username or handle column in the uploaded file. Please ensure your sheet has a column header named 'username' or 'handle'." 
      });
    }

    const rows = xlsx.utils.sheet_to_json(sheet);
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Uploaded file is empty.' });
    }

    const fileUsernames = new Set();
    rows.forEach(row => {
      const val = row[usernameCol];
      if (val) {
        fileUsernames.add(String(val).trim().toLowerCase());
      }
    });

    // Get active students eligible for this contest
    const activeStudents = await db.query(
      "SELECT id, leetcode_username, academic_start_date, academic_end_date FROM Users WHERE status = 'active'"
    );

    const cDate = new Date(cDateStr);
    cDate.setHours(12, 0, 0, 0);

    const eligibleStudents = activeStudents.filter(s => {
      const start = new Date(s.academic_start_date);
      const end = new Date(s.academic_end_date);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return cDate >= start && cDate <= end;
    });

    let present = 0;
    let absent = 0;

    // Fetch all existing attendance records for this contest in a single query to prevent N+1 reads
    const existingRecords = await db.query(
      "SELECT user_id, attendance_source, attendance_status FROM AttendanceRecords WHERE contest_id = ?",
      [targetContestId]
    );
    const existingMap = new Map();
    existingRecords.forEach(r => {
      existingMap.set(r.user_id, r);
    });

    for (const student of eligibleStudents) {
      const rawUsername = student.leetcode_username || '';
      const lcUserLower = normalizeUsername(rawUsername);
      const attended = fileUsernames.has(lcUserLower);

      // Check if we already have a record in AttendanceRecords to prevent overwrites / downgrades
      const existing = existingMap.get(student.id);
      const hasManualOverride = existing && existing.attendance_source === 'MANUAL';
      const isAlreadyPresent = existing && existing.attendance_status === 'PRESENT';

      if (attended) {
        present++;
        
        // Ensure registered
        await db.query(
          "INSERT IGNORE INTO Registrations (user_id, contest_id) VALUES (?, ?)",
          [student.id, targetContestId]
        );

        // Insert into ParticipationLogs
        await db.query(
          `INSERT INTO ParticipationLogs (user_id, contest_id, join_time, participation_status)
           VALUES (?, ?, CURRENT_TIMESTAMP, 'JOINED')
           ON DUPLICATE KEY UPDATE join_time = CURRENT_TIMESTAMP, participation_status = 'JOINED'`,
          [student.id, targetContestId]
        );

        // Update AttendanceRecords if no manual override exists
        if (!hasManualOverride) {
          await db.query(
            `INSERT INTO AttendanceRecords (user_id, contest_id, attendance_status, attendance_source)
             VALUES (?, ?, 'PRESENT', 'AUTO')
             ON DUPLICATE KEY UPDATE attendance_status = 'PRESENT', attendance_source = 'AUTO'`,
            [student.id, targetContestId]
          );
        }
      } else {
        absent++;

        // Ensure registered
        await db.query(
          "INSERT IGNORE INTO Registrations (user_id, contest_id) VALUES (?, ?)",
          [student.id, targetContestId]
        );

        // Update AttendanceRecords to ABSENT only if no manual override exists and it's not a downgrade from PRESENT
        if (!hasManualOverride && !isAlreadyPresent) {
          await db.query(
            `INSERT INTO AttendanceRecords (user_id, contest_id, attendance_status, attendance_source)
             VALUES (?, ?, 'ABSENT', 'AUTO')
             ON DUPLICATE KEY UPDATE attendance_status = 'ABSENT', attendance_source = 'AUTO'`,
            [student.id, targetContestId]
          );
        }
      }
    }

    // Log unmatched handles for manual review
    const unmatchedHandles = [];
    const databaseUsernames = new Set(eligibleStudents.map(s => s.leetcode_username.trim().toLowerCase()));
    
    fileUsernames.forEach(fileUser => {
      if (!databaseUsernames.has(fileUser)) {
        unmatchedHandles.push(fileUser);
      }
    });

    const responsePayload = {
      success: true,
      message: 'Attendance processed and marked successfully.',
      summary: {
        totalEligibleStudents: eligibleStudents.length,
        present,
        absent,
        unmatchedCount: unmatchedHandles.length,
        unmatchedHandles: unmatchedHandles.slice(0, 100)
      }
    };

    console.log(`[Upload API Log] Selected Contest ID: ${targetContestId}`);
    console.log(`[Upload API Log] API Request URL: ${req.originalUrl || '/api/attendance/upload'}`);
    console.log(`[Upload API Log] Student Count: ${eligibleStudents.length} eligible`);
    console.log(`[Upload API Log] Participant Count: ${present}`);
    console.log(`[Upload API Log] Matching Results: present=${present}, absent=${absent}, unmatched=${unmatchedHandles.length}`);
    console.log(`[Upload API Log] Unmatched Handles:`, unmatchedHandles);
    console.log(`[Upload API Log] API Response:`, JSON.stringify(responsePayload.summary));

    return res.json(responsePayload);
  } catch (error) {
    console.error('[Upload API Log] Error processing attendance upload:', error.stack || error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error processing file.', 
      error: process.env.NODE_ENV !== 'production' ? error.stack || error.message : undefined
    });
  }
}

// 2. Get attendance sheets/list for a specific contest
async function getContestAttendance(req, res) {
  const { contestId } = req.params;
  let { batch, department, section } = req.query;
  const cName = contestId;

  // Normalize batch YYYY-YYYY format to YYYY-YY
  batch = normalizeBatchToShort(batch);

  if (!cName) {
    return res.status(400).json({ success: false, message: 'Contest name/ID is required.' });
  }

  try {
    // 1. Resolve the contest and its platform
    const contestRows = await db.query(
      "SELECT contest_id, platform, title, start_time, slug, contest_status, duration FROM Contests WHERE contest_id = ? OR slug = ?",
      [cName, cName]
    );
    if (contestRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Contest not found.' });
    }
    const contest = contestRows[0];
    const platform = (contest.platform || 'LeetCode').toLowerCase();

    // Map platform parameters
    const usernameCol = `${platform}_username`;
    const profileTable = platform === 'leetcode' ? 'LeetCodeProfiles' : 
                         platform === 'codechef' ? 'CodeChefProfiles' : 'CodeforcesProfiles';
    const defaultRating = platform === 'leetcode' ? 1500 : 0;

    // 2. Fetch all active students, left-joining correct platform profile
    let sql = `
      SELECT u.id as student_id, u.roll_no as register_number, u.name, u.department, u.section, u.academic_batch as academic_year,
             u.${usernameCol} as platform_username,
             u.academic_start_date, u.academic_end_date,
             ar.attendance_status, ar.attendance_source, ar.last_updated, ar.remarks,
             ar.rank as contest_rank, ar.score as problems_solved, ar.rating_change,
             (SELECT registration_time FROM Registrations r WHERE r.user_id = u.id AND r.contest_id = ?) as registration_time,
             (SELECT join_time FROM ParticipationLogs p WHERE p.user_id = u.id AND p.contest_id = ?) as join_time,
             (SELECT ca.attendanceStatus FROM ContestAttendance ca JOIN LiveContests lc ON ca.contestId = lc.id WHERE ca.studentId = u.id AND lc.contestSlug = ? LIMIT 1) as sync_status,
             IFNULL(lp.current_rating, ${defaultRating}) as current_rating
      FROM Users u
      LEFT JOIN AttendanceRecords ar ON u.id = ar.user_id AND ar.contest_id = ?
      LEFT JOIN ${profileTable} lp ON u.id = lp.user_id
      WHERE u.status = 'active'
    `;
    const params = [contest.contest_id, contest.contest_id, contest.slug, contest.contest_id];

    if (batch) {
      sql += ` AND u.academic_batch = ?`;
      params.push(batch);
    }
    if (department) {
      sql += ` AND u.department = ?`;
      params.push(department);
    }
    if (section) {
      sql += ` AND u.section = ?`;
      params.push(section);
    }
    sql += ` ORDER BY u.roll_no ASC`;

    const list = await db.query(sql, params);
    const now = new Date();

    const eligibleList = list.filter(item => {
      if (!item.academic_start_date || !item.academic_end_date) return false;
      const cDate = parseDateOnly(contest.start_time);
      const start = parseDateOnly(item.academic_start_date);
      const end = parseDateOnly(item.academic_end_date);
      end.setHours(23, 59, 59, 999);
      return cDate >= start && cDate <= end;
    });

    const formatted = eligibleList.map(item => {
      const cDateVal = new Date(contest.start_time);
      const durationMs = (contest.duration || 5400) * 1000;
      const endTime = new Date(cDateVal.getTime() + durationMs);
      const isOngoing = cDateVal <= now && endTime > now;
      const isUnrated = contest.contest_status && contest.contest_status.toLowerCase() === 'unrated';
      const isRegistered = item.registration_time !== null;

      // Determine final status and reason based on required Priority Order
      let status = 'absent';
      let reason = null;

      if (isOngoing || now < cDateVal) {
        status = 'contest in progress';
      } else {
        // Priority 1: Manual Override
        if (item.attendance_source === 'MANUAL' && item.attendance_status) {
          const hasAttended = item.attendance_status === 'PRESENT';
          status = hasAttended ? 'present' : 'absent';
          reason = hasAttended ? 'Manual Override (PRESENT)' : 'Manual Override (ABSENT)';
        }
        // Priority 2: Official Leaderboard (from ContestAttendance)
        else if (item.sync_status === 'Present' || item.sync_status === 'Participating') {
          status = 'present';
          reason = 'Participated via official leaderboard';
        }
        // Priority 3: Contest Rank
        else if (item.contest_rank !== null && item.contest_rank > 0) {
          status = 'present';
          reason = 'Participated via official leaderboard';
        }
        // Priority 4: Participation Log (join_time exists)
        else if (item.join_time !== null) {
          status = 'present';
          reason = 'Participation Log';
        }
        // Priority 4b: Already marked PRESENT in database
        else if (item.attendance_status === 'PRESENT') {
          status = 'present';
          reason = 'Participated via official leaderboard';
        }
        // Priority 5: Incomplete Leaderboard
        else if (item.sync_status === 'Unknown') {
          status = 'unknown';
          reason = 'Leaderboard Sync Incomplete';
        }
        // Priority 6: Registered but missing
        else if (isRegistered) {
          status = 'absent';
          reason = 'Registered but Did Not Participate';
        }
        // Priority 7: Not Registered
        else {
          status = 'absent';
          reason = 'Not Registered';
        }
      }

      // Print diagnostics block for every student as requested
      const normalizedUsername = normalizeUsername(item.platform_username);
      const isFoundInLeaderboard = item.sync_status === 'Present' || item.sync_status === 'Participating' || (item.contest_rank !== null && item.contest_rank > 0);
      console.log(`[ATTENDANCE DECISION]\nStudent:\n${item.student_id}\n\nUsername:\n${item.platform_username || ''}\n\nNormalized:\n${normalizedUsername}\n\nRegistered:\n${isRegistered}\n\nLeaderboard:\n${isFoundInLeaderboard}\n\nContest Rank:\n${item.contest_rank}\n\nJoin Time:\n${item.join_time}\n\nContestAttendance:\n${item.sync_status || 'null'}\n\nAttendanceRecords:\n${item.attendance_status || 'null'}\n\nDecision:\n${status.toUpperCase()}\n\nReason:\n${reason || 'null'}\n====================================================`);

      return {
        student_id: item.student_id,
        register_number: item.register_number,
        name: item.name,
        department: item.department,
        section: item.section,
        academic_year: item.academic_year,
        platform_username: item.platform_username || '',
        contest_date: contest.start_time,
        contest_slug: contest.slug,
        contest_status: contest.contest_status,
        registration_time: item.registration_time,
        join_time: item.join_time,
        current_rating: item.current_rating,
        status: status,
        marked_by: item.attendance_source === 'MANUAL' ? 'faculty' : 'system',
        remarks: item.remarks,
        last_updated: item.last_updated,
        contest_rank: item.contest_rank,
        rating_change: item.rating_change || 0,
        problems_solved: item.problems_solved !== null ? item.problems_solved : (status === 'present' ? 4 : 0),
        total_problems: platform === 'leetcode' ? 4 : null,
        reason: reason
      };
    });

    const presentList = formatted.filter(s => s.status === 'present');
    const absentList = formatted.filter(s => s.status === 'absent');

    return res.json({ 
      success: true, 
      count: formatted.length, 
      data: formatted,
      attended: presentList,
      missed: absentList
    });
  } catch (error) {
    console.error('[Attendance API Log] Error fetching contest attendance:', error.stack || error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve attendance list.', 
      error: process.env.NODE_ENV !== 'production' ? error.stack || error.message : undefined 
    });
  }
}

// 3. Manual Attendance Override
async function overrideAttendance(req, res) {
  const { studentId, contestName, contestId, status, remarks } = req.body;
  const cName = contestName || contestId;

  if (!studentId || !cName || status === undefined) {
    return res.status(400).json({ success: false, message: 'Student ID, Contest Name/ID, and Status are required.' });
  }

  try {
    const studentCheck = await db.query("SELECT academic_start_date, academic_end_date FROM Users WHERE id = ?", [studentId]);
    if (studentCheck.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const contestSlug = cName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const dateResult = await db.query(
      "SELECT contest_id, start_time FROM Contests WHERE slug = ? LIMIT 1",
      [contestSlug]
    );
    
    let targetContestId;
    let cDate;

    if (dateResult.length > 0) {
      targetContestId = dateResult[0].contest_id;
      cDate = formatDate(dateResult[0].start_time);
    } else {
      cDate = new Date().toISOString().split('T')[0];
      const contestType = contestSlug.includes('biweekly') ? 'Biweekly' : 'Weekly';
      const match = contestSlug.match(/contest-(\d+)/);
      const contestNumber = match ? parseInt(match[1], 10) : 0;
      
      const insertResult = await db.query(`
        INSERT INTO Contests (title, slug, contest_type, contest_number, start_time, contest_status)
        VALUES (?, ?, ?, ?, ?, 'Rated')
      `, [cName, contestSlug, contestType, contestNumber, cDate]);
      targetContestId = insertResult.insertId;
    }

    const attendanceStatus = (status === 'present' || status === 1 || status === true) ? 'PRESENT' : 'ABSENT';

    // Ensure registered
    await db.query(
      "INSERT IGNORE INTO Registrations (user_id, contest_id) VALUES (?, ?)",
      [studentId, targetContestId]
    );

    if (attendanceStatus === 'PRESENT') {
      // Log participation
      await db.query(
        `INSERT INTO ParticipationLogs (user_id, contest_id, join_time, participation_status)
         VALUES (?, ?, CURRENT_TIMESTAMP, 'JOINED')
         ON DUPLICATE KEY UPDATE join_time = CURRENT_TIMESTAMP, participation_status = 'JOINED'`,
        [studentId, targetContestId]
      );
    } else {
      // Remove participation log
      await db.query(
        "DELETE FROM ParticipationLogs WHERE user_id = ? AND contest_id = ?",
        [studentId, targetContestId]
      );
    }

    // Insert or Update AttendanceRecords
    await db.query(
      `INSERT INTO AttendanceRecords (user_id, contest_id, attendance_status, attendance_source, remarks)
       VALUES (?, ?, ?, 'MANUAL', ?)
       ON DUPLICATE KEY UPDATE attendance_status = VALUES(attendance_status), attendance_source = 'MANUAL', remarks = VALUES(remarks)`,
      [studentId, targetContestId, attendanceStatus, remarks || null]
    );

    // Create notification
    await db.query(
      `INSERT INTO notifications (title, message, type, student_id)
       VALUES (?, ?, 'new_contest', ?)`,
      [
        `Attendance Overridden`,
        `Attendance for ${cName} has been manually marked as ${attendanceStatus.toLowerCase()}.`,
        studentId
      ]
    );

    const responsePayload = {
      success: true,
      message: `Successfully marked student as ${attendanceStatus.toLowerCase()}.`
    };

    console.log(`[Override API Log] Selected Contest ID: ${targetContestId}`);
    console.log(`[Override API Log] API Request URL: ${req.originalUrl || '/api/attendance/override'}`);
    console.log(`[Override API Log] Matching Results: manual override to ${attendanceStatus} for studentId ${studentId}`);
    console.log(`[Override API Log] Remarks: ${remarks}`);
    console.log(`[Override API Log] API Response:`, JSON.stringify(responsePayload));

    return res.json(responsePayload);
  } catch (error) {
    console.error('[Override API Log] Error overriding attendance:', error.stack || error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to save attendance override.',
      error: process.env.NODE_ENV !== 'production' ? error.stack || error.message : undefined
    });
  }
}

// 4. Get student-specific attendance history
async function getStudentAttendanceHistory(req, res) {
  const { studentId } = req.params;
  const { refresh } = req.query;

  // Enforce ownership check for Students
  const requester = req.user;
  if (requester && (requester.role === 'Student' || !['Super Admin', 'Faculty', 'HOD'].includes(requester.role))) {
    if (String(requester.id) !== String(studentId) && String(requester.studentId) !== String(studentId)) {
      return res.status(403).json({ success: false, message: 'Forbidden: You can only view your own attendance history.' });
    }
  }

  try {
    const studentRows = await db.query(
      "SELECT id, name, roll_no, department, leetcode_username, codechef_username, academic_batch, academic_start_date, academic_end_date FROM Users WHERE id = ?",
      [studentId]
    );
    if (studentRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    const student = studentRows[0];
    const { leetcode_username, codechef_username } = student;
    const startDate = parseDateOnly(student.academic_start_date);
    const endDate = parseDateOnly(student.academic_end_date);
    if (endDate) {
      endDate.setHours(23, 59, 59, 999);
    }

    // Fetch LeetCode Profile
    let profileRows = await db.query(
      "SELECT current_rating, highest_rating, global_ranking, problems_solved, contest_history FROM LeetCodeProfiles WHERE user_id = ?",
      [studentId]
    );
    let profile = profileRows.length > 0 ? profileRows[0] : null;
    let rawHistory = profile && profile.contest_history ? JSON.parse(profile.contest_history) : [];

    // Live refresh if requested or cache is empty
    if (refresh === 'true' || !profile || !profile.contest_history || rawHistory.length === 0) {
      console.log(`[Attendance API] Refreshing LeetCode history for ${leetcode_username}...`);
      try {
        const leetcodeData = await leetcode.getUserContestRankingAndHistory(leetcode_username);
        if (leetcodeData) {
          const history = leetcodeData.userContestRankingHistory || [];
          const ratings = history.map(h => h.rating).filter(r => r !== null && r !== undefined);
          const highestRating = ratings.length > 0 ? Math.max(...ratings) : 1500.00;
          const currentRating = leetcodeData.userContestRanking ? parseFloat(leetcodeData.userContestRanking.rating || 1500.00) : 1500.00;
          const globalRanking = leetcodeData.userContestRanking ? leetcodeData.userContestRanking.globalRanking : null;
          const problemsSolved = 0;
          const historyJson = JSON.stringify(history);

          await db.query(`
            INSERT INTO LeetCodeProfiles (user_id, current_rating, highest_rating, global_ranking, problems_solved, contest_history)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              current_rating = VALUES(current_rating),
              highest_rating = VALUES(highest_rating),
              global_ranking = VALUES(global_ranking),
              problems_solved = VALUES(problems_solved),
              contest_history = VALUES(contest_history)
          `, [studentId, currentRating, highestRating, globalRanking, problemsSolved, historyJson]);

          // Reload updated profile
          profileRows = await db.query(
            "SELECT current_rating, highest_rating, global_ranking, problems_solved, contest_history FROM LeetCodeProfiles WHERE user_id = ?",
            [studentId]
          );
          profile = profileRows.length > 0 ? profileRows[0] : null;
          rawHistory = history;
        }
      } catch (err) {
        console.error(`[Attendance API] LeetCode sync failed for ${leetcode_username}:`, err.message);
        // Fall back to cache if available
      }
    }

    const leetcodeRanking = profile ? {
      rating: parseFloat(profile.current_rating),
      globalRanking: profile.global_ranking,
      attendedContestsCount: rawHistory.length
    } : null;

    // ── CodeChef History ──────────────────────────────────────────────────────
    let codechefHistory = [];
    let codechefRanking = null;

    if (codechef_username && codechef_username.trim()) {
      // Try DB cache first
      let ccProfileRows = await db.query(
        "SELECT current_rating, highest_rating, global_ranking, stars, contest_history FROM CodeChefProfiles WHERE user_id = ?",
        [studentId]
      );
      let ccProfile = ccProfileRows.length > 0 ? ccProfileRows[0] : null;
      let rawCcHistory = ccProfile && ccProfile.contest_history ? JSON.parse(ccProfile.contest_history) : [];

      // Refresh if requested or cache is empty
      if (refresh === 'true' || !ccProfile || !ccProfile.contest_history || rawCcHistory.length === 0) {
        console.log(`[Attendance API] Refreshing CodeChef history for ${codechef_username}...`);
        try {
          const ccData = await getUserCodeChefStats(codechef_username);
          if (ccData && ccData.success) {
            const ccContestList = ccData.contestHistory || [];
            const ccRating = ccData.rating ?? null;
            const ccHighest = ccData.maxRating ?? ccRating ?? null;
            const ccLowest = ccData.lowestRating ?? null;
            const ccRatingHistory = ccData.ratingHistory || [];
            const ccHistoryJson = JSON.stringify(ccContestList);

            const isRated = ccRating !== null;
            const isProvisional = ccData.isProvisional || false;
            let status = 'UNRATED';
            if (isRated) {
              status = isProvisional ? 'PROVISIONAL' : 'RATED';
            }

            console.log('[AUDIT][DB SAVE] currentRating =', ccRating, 'highestRating =', ccHighest, 'lowestRating =', ccLowest, 'ratingHistory.length =', ccRatingHistory.length);
            console.log('[AUDIT LOG][Database Save][Attendance] currentRating =', ccRating);
            await db.query(`
              INSERT INTO CodeChefProfiles (user_id, current_rating, highest_rating, lowest_rating, is_provisional, status, global_ranking, problems_solved, stars, contest_history, rating_history)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                current_rating = COALESCE(VALUES(current_rating), current_rating),
                highest_rating = COALESCE(VALUES(highest_rating), highest_rating),
                lowest_rating = COALESCE(VALUES(lowest_rating), lowest_rating),
                is_provisional = COALESCE(VALUES(is_provisional), is_provisional),
                status = COALESCE(VALUES(status), status),
                global_ranking = COALESCE(VALUES(global_ranking), global_ranking),
                problems_solved = GREATEST(COALESCE(VALUES(problems_solved), 0), COALESCE(problems_solved, 0)),
                stars = COALESCE(VALUES(stars), stars),
                contest_history = COALESCE(VALUES(contest_history), contest_history),
                rating_history = COALESCE(VALUES(rating_history), rating_history)
            `, [
              studentId,
              ccRating,
              ccHighest,
              ccLowest,
              isProvisional ? 1 : 0,
              status,
              ccData.globalRanking || null,
              ccData.problemsSolved || 0,
              ccData.stars || null,
              ccContestList.length > 0 ? ccHistoryJson : null,
              ccRatingHistory.length > 0 ? JSON.stringify(ccRatingHistory) : null
            ]);

            // Reload from DB
            ccProfileRows = await db.query(
              "SELECT current_rating, highest_rating, global_ranking, stars, contest_history FROM CodeChefProfiles WHERE user_id = ?",
              [studentId]
            );
            ccProfile = ccProfileRows.length > 0 ? ccProfileRows[0] : null;
            rawCcHistory = ccContestList;
            console.log(`[Attendance API] CodeChef sync complete for ${codechef_username}: ${ccContestList.length} contests fetched.`);
          }
        } catch (ccErr) {
          console.error(`[Attendance API] CodeChef sync failed for ${codechef_username}:`, ccErr.message);
          // Fall back to cached data
        }
      }

      codechefHistory = rawCcHistory;
      if (ccProfile) {
        codechefRanking = {
          rating: ccProfile.current_rating || 0,
          highestRating: ccProfile.highest_rating || 0,
          globalRanking: ccProfile.global_ranking || null,
          stars: ccProfile.stars || null,
          attendedContestsCount: rawCcHistory.length
        };
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Build map of attended LeetCode contests
    const attendedTitles = new Set();
    rawHistory.forEach(h => {
      if (h.attended && h.contest && h.contest.title) {
        attendedTitles.add(h.contest.title.trim().toLowerCase());
      }
    });

    // Fetch contests from DB
    const history = await db.query(
      `SELECT c.contest_id, c.title as contest_name, c.slug as contest_slug, c.start_time as contest_date, c.contest_status, c.contest_type, c.duration,
              ar.attendance_status, ar.attendance_source,
              (SELECT COUNT(*) FROM Registrations r WHERE r.contest_id = c.contest_id AND r.user_id = ?) as is_registered,
              (SELECT COUNT(*) FROM ParticipationLogs p WHERE p.contest_id = c.contest_id AND p.user_id = ?) as is_joined
       FROM Contests c
       LEFT JOIN AttendanceRecords ar ON c.contest_id = ar.contest_id AND ar.user_id = ?
       ORDER BY c.start_time DESC`,
      [studentId, studentId, studentId]
    );

    const now = new Date();

    const formatted = history.map(item => {
      const contestDate = parseDateOnly(item.contest_date);
      const isEligible = contestDate >= startDate && contestDate <= endDate;
      
      const startTime = new Date(item.contest_date);
      const durationMs = (item.duration || 5400) * 1000;
      const endTime = new Date(startTime.getTime() + durationMs);
      
      const isOngoing = startTime <= now && endTime > now;
      const isUnrated = item.contest_status && item.contest_status.toLowerCase() === 'unrated';
      
      let hasAttended = false;
      if (item.attendance_source === 'MANUAL' && item.attendance_status) {
        hasAttended = item.attendance_status === 'PRESENT';
      } else {
        hasAttended = attendedTitles.has(item.contest_name.trim().toLowerCase()) || item.is_joined > 0;
      }
      
      let attendanceStatus = 'ABSENT';
      if (!isEligible) {
        attendanceStatus = 'NOT_APPLICABLE';
      } else if (isOngoing) {
        attendanceStatus = 'ONGOING';
      } else if (isUnrated) {
        attendanceStatus = 'UNRATED';
      } else if (hasAttended) {
        attendanceStatus = 'PRESENT';
      } else {
        attendanceStatus = 'ABSENT';
      }

      // Extract performance data from LeetCode history if available
      const lcMatch = rawHistory.find(h => h.contest && h.contest.title.trim().toLowerCase() === item.contest_name.trim().toLowerCase());

      // Also check CodeChef history for this contest (by title match)
      const normalizedTitle = item.contest_name.trim().toLowerCase();
      const ccMatch = codechefHistory.find(h => {
        const ccTitle = (h.contestName || (h.contest && h.contest.title) || '').trim().toLowerCase();
        return ccTitle === normalizedTitle;
      });

      // Prefer LeetCode match, fall back to CodeChef match
      const perfMatch = lcMatch || ccMatch;

      const problems_solved = lcMatch ? lcMatch.problemsSolved : (ccMatch ? null : (attendanceStatus === 'PRESENT' ? 4 : 0));
      const total_problems = lcMatch ? lcMatch.totalProblems : (ccMatch ? null : 4);
      const global_rank = lcMatch ? lcMatch.ranking : (ccMatch ? ccMatch.rank : null);
      const rating = lcMatch ? Math.round(lcMatch.rating) : (ccMatch ? ccMatch.newRating : null);
      const rating_change = lcMatch && lcMatch.ratingChange ? parseFloat(lcMatch.ratingChange) : (ccMatch ? ccMatch.ratingChange : 0);

      return {
        ...item,
        status: attendanceStatus === 'PRESENT' ? 'attended' : (attendanceStatus === 'ABSENT' ? 'not attended' : attendanceStatus.toLowerCase()),
        attendance_status: attendanceStatus,
        eligibility_status: isEligible ? 'Eligible' : 'Outside Academic Period',
        marked_by: item.attendance_source === 'MANUAL' ? 'faculty' : 'system',
        last_updated: null,
        global_rank,
        rating,
        rating_change,
        problems_solved,
        total_problems,
        is_registered: item.is_registered > 0 || attendanceStatus === 'PRESENT',
        is_joined: item.is_joined > 0 || attendanceStatus === 'PRESENT'
      };
    });

    const eligibleRecords = formatted.filter(item => item.eligibility_status === 'Eligible');
    const totalContests = eligibleRecords.length;
    
    const ratedEligibleRecords = eligibleRecords.filter(item => item.attendance_status === 'PRESENT' || item.attendance_status === 'ABSENT');
    const totalRated = ratedEligibleRecords.length;
    const present = ratedEligibleRecords.filter(item => item.attendance_status === 'PRESENT').length;
    const absent = ratedEligibleRecords.filter(item => item.attendance_status === 'ABSENT').length;
    
    const unrated = eligibleRecords.filter(item => item.attendance_status === 'UNRATED').length;
    const ongoing = eligibleRecords.filter(item => item.attendance_status === 'ONGOING').length;
    
    const attendancePercentage = totalRated > 0 ? parseFloat(((present / totalRated) * 100).toFixed(1)) : 100.0;

    const metrics = {
      totalContests,
      ratedContests: totalRated,
      unratedContests: unrated,
      ongoingContests: ongoing,
      present,
      absent,
      presentRated: present,
      presentUnrated: 0,
      attendancePercentage
    };

    return res.json({
      success: true,
      metrics,
      data: formatted,
      leetcodeHistory: rawHistory,
      leetcodeRanking,
      codechefHistory,
      codechefRanking
    });
  } catch (error) {
    console.error('Error fetching student attendance history:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve attendance history.' });
  }
}

module.exports = {
  processContestUpload,
  getContestAttendance,
  overrideAttendance,
  getStudentAttendanceHistory
};
