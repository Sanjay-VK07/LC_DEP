const db = require('../config/db');
const xlsx = require('xlsx');
const leetcode = require('../utils/leetcode');
const { getUserCodeChefStats } = require('../utils/codechef');
const { normalizeBatchToShort } = require('../utils/batchHelper');
const { normalizeUsername } = require('../utils/usernameNormalizer');
const attendanceService = require('../services/attendanceService');
const { normalizeAttendanceStatus } = require('../utils/attendanceNormalizer');

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
    const databaseUsernames = new Set(
      eligibleStudents
        .filter(s => s.leetcode_username)
        .map(s => s.leetcode_username.trim().toLowerCase())
    );
    
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

// 2. Get attendance sheets/list for a specific contest with pagination and timing telemetry
async function getContestAttendance(req, res) {
  const reqStart = Date.now();
  const { contestId } = req.params;
  let { batch, department, section, page, limit } = req.query;

  if (!contestId) {
    return res.status(400).json({ success: false, message: 'Contest name/ID is required.' });
  }

  try {
    console.log(`[API Start] GET /api/attendance/contest/${contestId} | Query:`, req.query);
    const result = await attendanceService.getContestParticipantsDetails(contestId, { batch, department, section });
    const allData = result.data || [];
    const totalCount = allData.length;

    let paginatedData = allData;
    let pageNum = page ? parseInt(page, 10) : 1;
    let limitNum = limit ? parseInt(limit, 10) : totalCount;

    if (page && limit && limit !== 'all') {
      const startIndex = (pageNum - 1) * limitNum;
      paginatedData = allData.slice(startIndex, startIndex + limitNum);
    }

    const totalTimeMs = Date.now() - reqStart;
    const responsePayload = {
      success: true,
      count: paginatedData.length,
      total: totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages: limitNum > 0 ? Math.ceil(totalCount / limitNum) : 1,
      data: paginatedData,
      attended: result.attended,
      missed: result.missed,
      summary: result.summary,
      validationStatus: result.validationStatus,
      validationIssues: result.validationIssues,
      timing: {
        startTime: new Date(reqStart).toISOString(),
        totalTimeMs,
        rowsReturned: paginatedData.length,
        totalRows: totalCount
      }
    };

    const payloadJson = JSON.stringify(responsePayload);
    console.log(`[API Response Telemetry] GET /api/attendance/contest/${contestId} | Rows: ${paginatedData.length}/${totalCount} | Time: ${totalTimeMs}ms | Size: ${payloadJson.length} bytes`);

    if (typeof res.set === 'function') {
      res.set('Cache-Control', 'no-store');
      res.set('X-Response-Time', `${totalTimeMs}ms`);
    }

    return res.json(responsePayload);
  } catch (error) {
    console.error('[Attendance API Log] Error fetching contest attendance:', error.stack || error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to retrieve attendance list.', 
      error: process.env.NODE_ENV !== 'production' ? error.stack || error.message : undefined 
    });
  }
}

// 2b. Export Contest Attendance Excel file (Backend Streaming)
async function exportContestAttendance(req, res) {
  const reqStart = Date.now();
  const { contestId } = req.params;
  let { batch, department, section } = req.query;

  if (!contestId) {
    return res.status(400).json({ success: false, message: 'Contest name/ID is required.' });
  }

  try {
    console.log(`[Export API Start] GET /api/attendance/contest/${contestId}/export`);
    const result = await attendanceService.getContestParticipantsDetails(contestId, { batch, department, section });
    const studentsList = result.data || [];
    const dbTimeMs = Date.now() - reqStart;

    const excelStart = Date.now();
    const headers = [
      'Roll Number', 'Student Name', 'Department', 'Section', 'Batch',
      'LeetCode Username', 'Registration Status', 'Join Status', 'Attendance Status',
      'Contest Rank', 'Problems Solved', 'Contest Score', 'Marked By', 'Remarks'
    ];

    const rows = studentsList.map(s => [
      s.register_number || '',
      s.name || '',
      s.department || '',
      s.section || '',
      s.academic_year || '',
      s.leetcode_username || s.platform_username || '',
      s.registration_time ? 'Registered' : 'Not Registered',
      s.join_time ? 'Joined' : 'No Activity',
      (s.status || 'absent').toUpperCase(),
      s.contest_rank || '-',
      s.problems_solved !== null && s.problems_solved !== undefined ? s.problems_solved : '-',
      s.contest_score !== null && s.contest_score !== undefined ? s.contest_score : '-',
      s.marked_by || 'system',
      s.remarks || ''
    ]);

    const worksheet = xlsx.utils.aoa_to_sheet([headers, ...rows]);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Contest Attendance');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const excelTimeMs = Date.now() - excelStart;
    const totalTimeMs = Date.now() - reqStart;

    console.log(`[Export Telemetry] Contest: ${contestId} | DB Time: ${dbTimeMs}ms | Excel Gen Time: ${excelTimeMs}ms | Total Time: ${totalTimeMs}ms | Rows: ${rows.length} | Size: ${buffer.length} bytes`);

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="contest_attendance_${contestId}_${new Date().toISOString().split('T')[0]}.xlsx"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store'
    });

    return res.send(buffer);
  } catch (error) {
    console.error('[Export API Error]', error.stack || error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to generate contest attendance Excel file.'
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
      if (item.attendance_status) {
        hasAttended = normalizeAttendanceStatus(item.attendance_status) === 'PRESENT';
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
        attendance_status: normalizeAttendanceStatus(attendanceStatus),
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
  exportContestAttendance,
  overrideAttendance,
  getStudentAttendanceHistory
};
