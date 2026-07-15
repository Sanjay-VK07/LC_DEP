const db = require('../config/db');

async function run() {
  let connection;
  try {
    await db.initializeDatabase();
    connection = await db.getPool().getConnection();
    console.log("Connected to database for cleanup.");

    // Start transaction
    await connection.beginTransaction();
    console.log("Transaction started.");

    // Disable FK checks temporarily for cleanup
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    // 1. Fetch mismatches in AttendanceRecords
    const mismatches = await connection.query(`
      SELECT ar.id, ar.user_id, ar.contest_id as old_contest_id, ar.contest_slug, ar.attendance_status, 
             ar.rank, ar.score, ar.problems_solved, ar.rating_after, ar.rating_before, ar.rating_change, 
             c.contest_id as correct_contest_id
      FROM AttendanceRecords ar
      JOIN Contests c ON ar.contest_slug = c.slug
      WHERE ar.contest_id != c.contest_id
    `);

    console.log(`Found ${mismatches[0].length} mismatched records in AttendanceRecords.`);
    let resolvedCount = 0;
    let deletedCount = 0;

    for (const row of mismatches[0]) {
      const { id, user_id, old_contest_id, correct_contest_id, attendance_status, rank, score, problems_solved, rating_after, rating_before, rating_change } = row;

      // Check if a record already exists with the correct contest_id for this user
      const [existing] = await connection.query(
        "SELECT id, attendance_status, `rank`, score, problems_solved FROM AttendanceRecords WHERE user_id = ? AND contest_id = ?",
        [user_id, correct_contest_id]
      );

      if (existing.length > 0) {
        // Correct record already exists. This is a duplicate!
        const correctRow = existing[0];
        console.log(`[Duplicate Found] User: ${user_id} | Correct Contest: ${correct_contest_id} | Old Row ID: ${id} | Correct Row ID: ${correctRow.id}`);

        // Merge row data: if old row was PRESENT but correct row was ABSENT, update correct row to PRESENT
        if (attendance_status === 'PRESENT' && correctRow.attendance_status !== 'PRESENT') {
          console.log(`Updating correct row ${correctRow.id} to PRESENT with Old Row's performance metrics...`);
          await connection.query(`
            UPDATE AttendanceRecords 
            SET attendance_status = 'PRESENT',
                \`rank\` = ?,
                score = ?,
                problems_solved = ?,
                rating_after = ?,
                rating_before = ?,
                rating_change = ?,
                attendance_source = 'AUTO',
                remarks = 'Merged duplicate attendance record'
            WHERE id = ?
          `, [rank, score, problems_solved, rating_after, rating_before, rating_change, correctRow.id]);
        }

        // Delete the incorrect row from AttendanceRecords
        await connection.query("DELETE FROM AttendanceRecords WHERE id = ?", [id]);
        deletedCount++;

        // Update / deduplicate Registrations
        const [regExists] = await connection.query(
          "SELECT 1 FROM Registrations WHERE user_id = ? AND contest_id = ?",
          [user_id, correct_contest_id]
        );
        if (regExists.length > 0) {
          // Both existed, delete the old one
          await connection.query("DELETE FROM Registrations WHERE user_id = ? AND contest_id = ?", [user_id, old_contest_id]);
        } else {
          // Correct didn't exist, update old one
          await connection.query("UPDATE Registrations SET contest_id = ? WHERE user_id = ? AND contest_id = ?", [correct_contest_id, user_id, old_contest_id]);
        }

        // Update / deduplicate ParticipationLogs
        const [partExists] = await connection.query(
          "SELECT 1 FROM ParticipationLogs WHERE user_id = ? AND contest_id = ?",
          [user_id, correct_contest_id]
        );
        if (partExists.length > 0) {
          await connection.query("DELETE FROM ParticipationLogs WHERE user_id = ? AND contest_id = ?", [user_id, old_contest_id]);
        } else {
          await connection.query("UPDATE ParticipationLogs SET contest_id = ? WHERE user_id = ? AND contest_id = ?", [correct_contest_id, user_id, old_contest_id]);
        }

      } else {
        // No duplicate, just mismatch. Update the contest_id to the correct one!
        console.log(`[Mismatch Only] User: ${user_id} | Updating contest_id ${old_contest_id} -> ${correct_contest_id} on AttendanceRecords ID: ${id}`);
        await connection.query("UPDATE AttendanceRecords SET contest_id = ? WHERE id = ?", [correct_contest_id, id]);

        // Update corresponding Registrations
        await connection.query(
          "UPDATE Registrations SET contest_id = ? WHERE user_id = ? AND contest_id = ?",
          [correct_contest_id, user_id, old_contest_id]
        );

        // Update corresponding ParticipationLogs
        await connection.query(
          "UPDATE ParticipationLogs SET contest_id = ? WHERE user_id = ? AND contest_id = ?",
          [correct_contest_id, user_id, old_contest_id]
        );

        resolvedCount++;
      }
    }

    // 2. Clean up any remaining invalid entries in Registrations or ParticipationLogs referencing non-existent contest_ids
    const [orphanRegs] = await connection.query(`
      DELETE r FROM Registrations r
      LEFT JOIN Contests c ON r.contest_id = c.contest_id
      WHERE c.contest_id IS NULL
    `);
    if (orphanRegs.affectedRows > 0) {
      console.log(`Removed ${orphanRegs.affectedRows} orphan records from Registrations.`);
    }

    const [orphanParts] = await connection.query(`
      DELETE p FROM ParticipationLogs p
      LEFT JOIN Contests c ON p.contest_id = c.contest_id
      WHERE c.contest_id IS NULL
    `);
    if (orphanParts.affectedRows > 0) {
      console.log(`Removed ${orphanParts.affectedRows} orphan records from ParticipationLogs.`);
    }

    // Re-enable FK checks
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");

    await connection.commit();
    console.log("Transaction committed successfully.");
    console.log(`Cleanup Summary: Mismatches Updated: ${resolvedCount} | Duplicates Merged & Deleted: ${deletedCount}`);

  } catch (err) {
    console.error("Cleanup failed. Rolling back...", err);
    if (connection) {
      await connection.rollback();
    }
  } finally {
    if (connection) connection.release();
    const pool = db.getPool();
    if (pool) await pool.end();
  }
}

run();
