const db = require('../config/db');

// 1. Get all departments
async function getDepartments(req, res) {
  const { status } = req.query;
  try {
    let sql = 'SELECT * FROM departments';
    const params = [];

    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }

    sql += ' ORDER BY name ASC';

    const list = await db.query(sql, params);
    console.log(`[Diagnostic] Departments fetched from DB count: ${list.length}`);
    console.log(`[Diagnostic] Departments returned by API count: ${list.length}`);
    return res.json({ success: true, count: list.length, data: list });
  } catch (error) {
    console.error('Error fetching departments:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve departments.' });
  }
}

// 2. Add department
async function addDepartment(req, res) {
  const { name, code, status } = req.body;

  if (!name || !code) {
    return res.status(400).json({ success: false, message: 'Name and Code are required.' });
  }

  const trimmedName = name.trim();
  const trimmedCode = code.trim().toUpperCase();
  const finalStatus = status || 'active';

  try {
    // Check duplicates
    const checkDup = await db.query('SELECT id FROM departments WHERE code = ?', [trimmedCode]);
    if (checkDup && checkDup.length > 0) {
      return res.status(400).json({ success: false, message: `Department code '${trimmedCode}' already exists.` });
    }

    const result = await db.query(
      'INSERT INTO departments (name, code, status) VALUES (?, ?, ?)',
      [trimmedName, trimmedCode, finalStatus]
    );

    return res.status(201).json({
      success: true,
      message: 'Department added successfully.',
      data: {
        id: result.insertId,
        name: trimmedName,
        code: trimmedCode,
        status: finalStatus
      }
    });
  } catch (error) {
    console.error('Error adding department:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

// 3. Edit department
async function editDepartment(req, res) {
  const { id } = req.params;
  const { name, code, status } = req.body;

  if (!name || !code || !status) {
    return res.status(400).json({ success: false, message: 'Name, Code, and Status are required.' });
  }

  const trimmedName = name.trim();
  const trimmedCode = code.trim().toUpperCase();

  try {
    // Check if exists
    const current = await db.query('SELECT * FROM departments WHERE id = ?', [id]);
    if (!current || current.length === 0) {
      return res.status(404).json({ success: false, message: 'Department not found.' });
    }

    // Check duplicate code if code changed
    if (current[0].code !== trimmedCode) {
      const checkDup = await db.query('SELECT id FROM departments WHERE code = ? AND id != ?', [trimmedCode, id]);
      if (checkDup && checkDup.length > 0) {
        return res.status(400).json({ success: false, message: `Department code '${trimmedCode}' is already in use.` });
      }
    }

    // Update. Note: ON UPDATE CASCADE on foreign keys automatically updates student records!
    await db.query(
      'UPDATE departments SET name = ?, code = ?, status = ? WHERE id = ?',
      [trimmedName, trimmedCode, status, id]
    );

    return res.json({
      success: true,
      message: 'Department updated successfully.'
    });
  } catch (error) {
    console.error('Error editing department:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

// 4. Delete department
async function deleteDepartment(req, res) {
  const { id } = req.params;

  try {
    // Check if exists
    const current = await db.query('SELECT code FROM departments WHERE id = ?', [id]);
    if (!current || current.length === 0) {
      return res.status(404).json({ success: false, message: 'Department not found.' });
    }

    const { code } = current[0];

    // Check if students exist in this department
    const studentCountResult = await db.query(
      'SELECT COUNT(*) as count FROM Users WHERE department = ?',
      [code]
    );

    const studentCount = studentCountResult[0]?.count || 0;
    if (studentCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete department '${code}' because it has ${studentCount} active or archived student profile(s) associated with it. Please reassign the students first, or disable the department instead.`
      });
    }

    // Safe to delete
    await db.query('DELETE FROM departments WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Department deleted successfully.' });
  } catch (error) {
    console.error('Error deleting department:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

module.exports = {
  getDepartments,
  addDepartment,
  editDepartment,
  deleteDepartment
};
