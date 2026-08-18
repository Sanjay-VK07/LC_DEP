const express = require('express');
const router = express.Router();
const departmentController = require('../controllers/departmentController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.get('/', authenticate, departmentController.getDepartments);
router.post('/', authenticate, authorize(['Super Admin']), departmentController.addDepartment);
router.put('/:id', authenticate, authorize(['Super Admin']), departmentController.editDepartment);
router.delete('/:id', authenticate, authorize(['Super Admin']), departmentController.deleteDepartment);

module.exports = router;
