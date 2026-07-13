const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const { getAdapter } = require('../services/adapters/AdapterFactory');
const studentController = require('../controllers/studentController');

before(async () => {
  await db.initializeDatabase();
  await db.query("DELETE FROM Users WHERE roll_no = 'CF-TEST-REG-001'");
});

test('Codeforces Verification Persistence - Unverified student -> Edit & Verify -> Remains Verified', async () => {
  // 1. Student initially unverified in database
  const insertRes = await db.query(
    `INSERT INTO Users (name, roll_no, department, section, leetcode_username, codeforces_username, codeforces_username_normalized, codeforces_verified, status, academic_batch, academic_start_date, academic_end_date)
     VALUES ('Ganeshkumar', 'CF-TEST-REG-001', 'CSE', 'A', 'ganeshkumar_lc', 'ganeshkumarr.cse2024', 'ganeshkumarr.cse2024', 0, 'active', '2024-2028', '2024-06-01', '2028-06-01')`
  );
  const studentId = insertRes.insertId || (insertRes[0] ? insertRes[0].insertId : null);

  // Mock Codeforces adapter for reliability
  const codeforcesAdapter = getAdapter('codeforces');
  const originalGetProfile = codeforcesAdapter.getProfile;
  codeforcesAdapter.getProfile = async (handle) => {
    return {
      verified: true,
      username: 'ganeshkumarr.cse2024',
      rating: 366,
      rank: 'newbie',
      maxRating: 366,
      maxRank: 'newbie'
    };
  };

  try {
    // 2. Open Edit (simulated via payload from frontend)
    // 3. Click Verify (platform checks state becomes verified)
    // 4. Save without changing username (section changed to B)
    const editPayload = {
      name: "Ganeshkumar",
      rollNo: "CF-TEST-REG-001",
      department: "CSE",
      section: "B",
      academicBatch: "2024-2028",
      academicStartDate: "2024-06-01",
      academicEndDate: "2028-06-01",
      leetcodeUsername: "ganeshkumar_lc",
      codechefUsername: "",
      codeforcesUsername: "ganeshkumarr.cse2024", // Unchanged username
      hackerrankUsername: "",
      leetcodeVerified: true,
      codechefVerified: false,
      codeforcesVerified: true, // newly verified on frontend
      codeforcesRating: 366,
      codeforcesRank: 'newbie',
      hackerrankVerified: false
    };

    const req = { params: { id: studentId }, body: editPayload };
    const res = {
      statusCode: 200,
      status: function(code) { this.statusCode = code; return this; },
      json: function(data) { this.data = data; return this; }
    };

    await studentController.editStudent(req, res);
    assert.equal(res.statusCode, 200);

    // 5. Reload (select directly from DB)
    const [userRow] = await db.query(
      "SELECT codeforces_username, codeforces_verified FROM Users WHERE id = ?",
      [studentId]
    );

    // 6. Student remains verified
    assert.equal(userRow.codeforces_username, 'ganeshkumarr.cse2024');
    assert.equal(userRow.codeforces_verified, 1);

    // Verify statistics are stored in CodeforcesProfiles
    const [profileRow] = await db.query(
      "SELECT current_rating, `rank` FROM CodeforcesProfiles WHERE user_id = ?",
      [studentId]
    );
    assert.ok(profileRow);
    assert.equal(profileRow.current_rating, 366);
    assert.equal(profileRow.rank, 'newbie');

  } finally {
    // Restore original mock and clean up database
    codeforcesAdapter.getProfile = originalGetProfile;
    await db.query("DELETE FROM Users WHERE id = ?", [studentId]);
  }
});

after(async () => {
  const pool = db.getPool();
  if (pool) {
    await pool.end();
  }
});
