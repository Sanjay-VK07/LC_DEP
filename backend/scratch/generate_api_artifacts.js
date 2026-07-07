const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:/Users/ganes/.gemini/antigravity/brain/e4190836-a14b-4056-9e8e-fae10a83506e';

// Ensure artifact directory exists
if (!fs.existsSync(ARTIFACT_DIR)) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

// Define the 45 base endpoints. Each will be generated twice: for /api/ and /api/v1/
const uniqueEndpoints = [
  // --- AUTHENTICATION ---
  {
    path: '/auth/login',
    method: 'POST',
    module: 'Authentication',
    controller: 'authController.login',
    description: 'Authenticates user credentials and returns a JWT token.',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [],
    queryParams: [],
    bodySchema: { username: 'string (required)', password: 'string (required)' },
    responseSchema: { success: 'boolean', token: 'string', user: { id: 'number', username: 'string', role: 'string', name: 'string', email: 'string', studentId: 'number|null' } },
    successCodes: [200],
    errorCodes: [400, 401, 500],
    validation: 'Verifies that username and password are provided in request body.',
    tables: ['Accounts'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { username: 'admin', password: 'secure_password_123' },
    exampleResponse: { success: true, token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', user: { id: 1, username: 'admin', role: 'Super Admin', name: 'System Admin', email: 'admin@enthrahub.edu', studentId: null } }
  },
  {
    path: '/auth/me',
    method: 'GET',
    module: 'Authentication',
    controller: 'authController.me',
    description: 'Retrieves profile details of the currently logged-in account.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', user: { id: 'number', username: 'string', role: 'string', name: 'string', email: 'string', studentId: 'number|null', created_at: 'string' } },
    successCodes: [200],
    errorCodes: [401, 404, 500],
    validation: 'Requires a valid JWT bearer token.',
    tables: ['Accounts'],
    middlewares: ['authenticate'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, user: { id: 1, username: 'admin', role: 'Super Admin', name: 'System Admin', email: 'admin@enthrahub.edu', studentId: null, created_at: '2026-06-30T06:00:00Z' } }
  },
  {
    path: '/auth/register',
    method: 'POST',
    module: 'Authentication',
    controller: 'authController.register',
    description: 'Registers a new system account (Super Admin only).',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>', 'Content-Type: application/json'],
    pathParams: [],
    queryParams: [],
    bodySchema: { username: 'string (required)', password: 'string (required)', role: 'string (required, e.g. Super Admin, HOD, Faculty, Student)', name: 'string', email: 'string', studentId: 'number|null' },
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [201],
    errorCodes: [400, 401, 403, 500],
    validation: 'Validates that username, password, and role are provided. Role authorization checks for Super Admin.',
    tables: ['Accounts'],
    middlewares: ['authenticate', 'authorize(["Super Admin"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { username: 'faculty_john', password: 'tempPassword123', role: 'Faculty', name: 'John Doe', email: 'john.doe@enthrahub.edu', studentId: null },
    exampleResponse: { success: true, message: 'Account for faculty_john created successfully' }
  },

  // --- DEPARTMENTS (Faculty/Admin/Other) ---
  {
    path: '/departments/',
    method: 'GET',
    module: 'Faculty',
    controller: 'departmentController.getDepartments',
    description: 'Retrieves all departments.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: [{ id: 'number', name: 'string', code: 'string', status: 'string', created_at: 'string', updated_at: 'string' }] },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['departments'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ id: 1, name: 'Computer Science and Engineering', code: 'CSE', status: 'active', created_at: '2026-06-30T06:00:00.000Z', updated_at: '2026-06-30T06:00:00.000Z' }] }
  },
  {
    path: '/departments/',
    method: 'POST',
    module: 'Admin',
    controller: 'departmentController.addDepartment',
    description: 'Creates a new department.',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [],
    queryParams: [],
    bodySchema: { name: 'string (required)', code: 'string (required, unique)', status: 'string (optional, default active)' },
    responseSchema: { success: 'boolean', data: { id: 'number', name: 'string', code: 'string', status: 'string' } },
    successCodes: [201],
    errorCodes: [400, 500],
    validation: 'Verifies name and code are provided.',
    tables: ['departments'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { name: 'Information Technology', code: 'IT' },
    exampleResponse: { success: true, data: { id: 2, name: 'Information Technology', code: 'IT', status: 'active' } }
  },
  {
    path: '/departments/:id',
    method: 'PUT',
    module: 'Admin',
    controller: 'departmentController.editDepartment',
    description: 'Updates details of an existing department.',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [{ name: 'id', type: 'integer', description: 'Department ID' }],
    queryParams: [],
    bodySchema: { name: 'string', status: 'string (active|inactive)' },
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 404, 500],
    validation: 'Requires department ID as path parameter.',
    tables: ['departments'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { name: 'Information Technology & Sciences', status: 'active' },
    exampleResponse: { success: true, message: 'Department updated successfully' }
  },
  {
    path: '/departments/:id',
    method: 'DELETE',
    module: 'Admin',
    controller: 'departmentController.deleteDepartment',
    description: 'Deletes a department from the system.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'id', type: 'integer', description: 'Department ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 404, 500],
    validation: 'Requires department ID as path parameter.',
    tables: ['departments'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Department deleted successfully' }
  },

  // --- STUDENTS ---
  {
    path: '/students/',
    method: 'GET',
    module: 'Students',
    controller: 'studentController.getStudents',
    description: 'Retrieves a paginated list of students with optional filters.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [
      { name: 'department', type: 'string', description: 'Filter by department code' },
      { name: 'section', type: 'string', description: 'Filter by section' },
      { name: 'academic_batch', type: 'string', description: 'Filter by academic batch' },
      { name: 'status', type: 'string', description: 'Filter by status (active/graduated)' },
      { name: 'page', type: 'integer', description: 'Page number (default 1)' },
      { name: 'limit', type: 'integer', description: 'Records per page (default 10)' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: [{ id: 'number', name: 'string', roll_no: 'string', department: 'string', section: 'string', leetcode_username: 'string', academic_batch: 'string', status: 'string' }], pagination: { total: 'number', page: 'number', limit: 'number', pages: 'number' } },
    successCodes: [200],
    errorCodes: [500],
    validation: 'Validates that query params are parsed correctly.',
    tables: ['Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ id: 10, name: 'Ganesh Kumar', roll_no: '24IT01', department: 'IT', section: 'A', leetcode_username: 'ganesh_lc', academic_batch: '2024-2028', status: 'active' }], pagination: { total: 1, page: 1, limit: 10, pages: 1 } }
  },
  {
    path: '/students/',
    method: 'POST',
    module: 'Students',
    controller: 'studentController.addStudent',
    description: 'Creates a new student record.',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [],
    queryParams: [],
    bodySchema: { name: 'string (required)', roll_no: 'string (required, unique)', department: 'string (required)', section: 'string (required)', leetcode_username: 'string (required, unique)', academic_batch: 'string (required)', academic_start_date: 'string (YYYY-MM-DD, required)', academic_end_date: 'string (YYYY-MM-DD, required)', codechef_username: 'string', codeforces_username: 'string', hackerrank_username: 'string' },
    responseSchema: { success: 'boolean', message: 'string', studentId: 'number' },
    successCodes: [201],
    errorCodes: [400, 500],
    validation: 'Verifies all required student fields are provided.',
    tables: ['Users', 'LeetCodeProfiles', 'CodeChefProfiles', 'CodeforcesProfiles', 'HackerRankProfiles', 'StudentPlatformSync'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { name: 'Rohan Sharma', roll_no: '24CS89', department: 'CSE', section: 'B', leetcode_username: 'rohan_lc', academic_batch: '2024-2028', academic_start_date: '2024-06-01', academic_end_date: '2028-05-31' },
    exampleResponse: { success: true, message: 'Student and profile structures registered successfully.', studentId: 105 }
  },
  {
    path: '/students/:id',
    method: 'PUT',
    module: 'Students',
    controller: 'studentController.editStudent',
    description: 'Updates an existing student details.',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [{ name: 'id', type: 'integer', description: 'Student ID' }],
    queryParams: [],
    bodySchema: { name: 'string', roll_no: 'string', department: 'string', section: 'string', leetcode_username: 'string', academic_batch: 'string', status: 'string' },
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 404, 500],
    validation: 'Requires student ID as path parameter.',
    tables: ['Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { section: 'C', status: 'active' },
    exampleResponse: { success: true, message: 'Student updated successfully.' }
  },
  {
    path: '/students/:id',
    method: 'DELETE',
    module: 'Students',
    controller: 'studentController.deleteStudent',
    description: 'Deletes a student and their platform profiles.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'id', type: 'integer', description: 'Student ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 404, 500],
    validation: 'Requires student ID as path parameter.',
    tables: ['Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Student and related records deleted successfully.' }
  },
  {
    path: '/students/import',
    method: 'POST',
    module: 'Students',
    controller: 'studentController.bulkImportStudents',
    description: 'Bulk imports students from an uploaded Excel or CSV file.',
    auth: 'No',
    headers: ['Content-Type: multipart/form-data'],
    pathParams: [],
    queryParams: [],
    bodySchema: { file: 'file (binary, required)' },
    responseSchema: { success: 'boolean', message: 'string', summary: { total: 'number', created: 'number', updated: 'number', failed: 'number' } },
    successCodes: [200],
    errorCodes: [400, 500],
    validation: 'Checks for file in request payload (limits to 5MB).',
    tables: ['Users', 'LeetCodeProfiles', 'CodeChefProfiles', 'CodeforcesProfiles', 'HackerRankProfiles', 'StudentPlatformSync'],
    middlewares: ['multerMiddleware'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null, // Binary file upload
    exampleResponse: { success: true, message: 'Bulk student import completed.', summary: { total: 50, created: 45, updated: 5, failed: 0 } }
  },
  {
    path: '/students/archive',
    method: 'POST',
    module: 'Students',
    controller: 'studentController.archiveStudents',
    description: 'Marks matching active students as graduated.',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [],
    queryParams: [],
    bodySchema: { department: 'string (required)', academicBatch: 'string (required)', section: 'string (optional)' },
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 404, 500],
    validation: 'Checks that department and batch are supplied.',
    tables: ['Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { department: 'CSE', academicBatch: '2020-2024' },
    exampleResponse: { success: true, message: 'Successfully marked 120 students as graduated.' }
  },
  {
    path: '/students/restore',
    method: 'POST',
    module: 'Students',
    controller: 'studentController.restoreStudents',
    description: 'Restores graduated student records to active status.',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [],
    queryParams: [],
    bodySchema: { studentId: 'number (optional, for individual)', department: 'string (optional, for batch)', academicBatch: 'string (optional, for batch)' },
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 500],
    validation: 'Verifies either studentId or department+batch is provided.',
    tables: ['Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { studentId: 15 },
    exampleResponse: { success: true, message: 'Successfully restored 1 student record to active status.' }
  },
  {
    path: '/students/archive-summary',
    method: 'GET',
    module: 'Students',
    controller: 'studentController.getArchivedSummary',
    description: 'Gets aggregates of archived/graduated students by department and batch.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', summary: [{ department: 'string', academic_batch: 'string', count: 'number' }] },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, summary: [{ department: 'CSE', academic_batch: '2020-2024', count: 120 }] }
  },
  {
    path: '/students/batches',
    method: 'GET',
    module: 'Students',
    controller: 'studentController.getUniqueBatches',
    description: 'Retrieves a list of all unique academic batches.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', batches: ['string'] },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, batches: ['2023-2027', '2024-2028'] }
  },
  {
    path: '/students/sections',
    method: 'GET',
    module: 'Students',
    controller: 'studentController.getUniqueSections',
    description: 'Retrieves all unique sections in the student base.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', sections: ['string'] },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, sections: ['A', 'B', 'C', 'D'] }
  },
  {
    path: '/students/data-health',
    method: 'GET',
    module: 'Admin',
    controller: 'studentController.getStudentsDataHealth',
    description: 'Audits student records for data anomalies, duplicate usernames, and missing platform links (Super Admin only).',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', healthReport: { totalStudents: 'number', completeProfiles: 'number', duplicates: { rollNo: 'number', leetcode: 'number' }, anomalies: 'array' } },
    successCodes: [200],
    errorCodes: [401, 403, 500],
    validation: 'Requires Super Admin credentials.',
    tables: ['Users', 'LeetCodeProfiles', 'CodeChefProfiles', 'CodeforcesProfiles', 'HackerRankProfiles'],
    middlewares: ['authenticate', 'authorize(["Super Admin"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, healthReport: { totalStudents: 345, completeProfiles: 280, duplicates: { rollNo: 0, leetcode: 2 }, anomalies: [] } }
  },
  {
    path: '/students/:id/sync/:platform',
    method: 'POST',
    module: 'Contest Synchronization',
    controller: 'studentController.syncStudentPlatformManual',
    description: 'Triggers manual profile synchronization for a single student on a platform.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [
      { name: 'id', type: 'integer', description: 'Student ID' },
      { name: 'platform', type: 'string', description: 'Platform (leetcode|codechef|codeforces|hackerrank)' }
    ],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string', status: 'string', completenessScore: 'number' },
    successCodes: [200],
    errorCodes: [400, 401, 403, 500],
    validation: 'Validates ID, platform constraints, and roles (Super Admin, Faculty, HOD).',
    tables: ['Users', 'LeetCodeProfiles', 'CodeChefProfiles', 'CodeforcesProfiles', 'HackerRankProfiles', 'StudentPlatformSync'],
    middlewares: ['authenticate', 'authorize(["Super Admin", "Faculty", "HOD"])'],
    externalApis: 'LeetCode, Codeforces, CodeChef, HackerRank',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Successfully synchronized leetcode', status: 'Success', completenessScore: 100 }
  },
  {
    path: '/students/sync-all',
    method: 'POST',
    module: 'Contest Synchronization',
    controller: 'studentController.forceFullSync',
    description: 'Forces full system-wide background sync of all active student profiles.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [401, 403, 500],
    validation: 'Requires Super Admin authentication.',
    tables: ['Users', 'StudentPlatformSync'],
    middlewares: ['authenticate', 'authorize(["Super Admin"])'],
    externalApis: 'LeetCode, Codeforces, CodeChef, HackerRank',
    cache: 'No',
    job: 'Yes',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Platform-wide synchronization started in background.' }
  },
  {
    path: '/students/clear-cache',
    method: 'POST',
    module: 'Cache',
    controller: 'studentController.clearCacheManual',
    description: 'Manually purges all cached reports and dashboard analytical structures.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [401, 403, 500],
    validation: 'Requires Super Admin authorization.',
    tables: [],
    middlewares: ['authenticate', 'authorize(["Super Admin"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Analytics and placement cache successfully invalidated.' }
  },
  {
    path: '/students/verify-leetcode/:username',
    method: 'GET',
    module: 'Students',
    controller: 'studentController.checkUsername',
    description: 'Helper to verify if a LeetCode username is valid and exists on LeetCode.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'username', type: 'string', description: 'LeetCode username' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', exists: 'boolean', username: 'string' },
    successCodes: [200],
    errorCodes: [400, 500],
    validation: 'Path parameter username verification.',
    tables: [],
    middlewares: [],
    externalApis: 'LeetCode',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, exists: true, username: 'testuser' }
  },
  {
    path: '/students/verify-platform/:platform/:username',
    method: 'GET',
    module: 'Students',
    controller: 'studentController.checkPlatformUsername',
    description: 'Helper to verify if a username is valid on a specific coding platform.',
    auth: 'No',
    headers: [],
    pathParams: [
      { name: 'platform', type: 'string', description: 'leetcode|codechef|codeforces|hackerrank' },
      { name: 'username', type: 'string', description: 'Platform username' }
    ],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', exists: 'boolean', platform: 'string', username: 'string' },
    successCodes: [200],
    errorCodes: [400, 500],
    validation: 'Path parameter verification.',
    tables: [],
    middlewares: [],
    externalApis: 'LeetCode, Codeforces, CodeChef, HackerRank',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, exists: true, platform: 'codeforces', username: 'tourist' }
  },
  {
    path: '/students/:id/unified-profile',
    method: 'GET',
    module: 'Students',
    controller: 'studentController.getUnifiedProfileById',
    description: 'Retrieves unified academic and multi-platform statistics profile for a student.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'id', type: 'integer', description: 'Student ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', profile: { id: 'number', name: 'string', roll_no: 'string', department: 'string', section: 'string', platforms: { leetcode: 'object', codechef: 'object', codeforces: 'object', hackerrank: 'object' } } },
    successCodes: [200],
    errorCodes: [404, 500],
    validation: 'ID validation.',
    tables: ['Users', 'LeetCodeProfiles', 'CodeChefProfiles', 'CodeforcesProfiles', 'HackerRankProfiles', 'Contest_Summary'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, profile: { id: 10, name: 'Ganesh Kumar', roll_no: '24IT01', department: 'IT', section: 'A', platforms: { leetcode: { username: 'ganesh_lc', ranking: 12450, solved: 320 } } } }
  },
  {
    path: '/students/:id/leetcode-stats',
    method: 'GET',
    module: 'Students',
    controller: 'studentController.getLeetCodeStatsById',
    description: 'Retrieves specific LeetCode contest statistics and ratings for a student.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'id', type: 'integer', description: 'Student ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', stats: { user_id: 'number', username: 'string', current_rating: 'number', highest_rating: 'number', contests_attended: 'number' } },
    successCodes: [200],
    errorCodes: [404, 500],
    validation: 'ID validation.',
    tables: ['LeetCodeProfiles'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, stats: { user_id: 10, username: 'ganesh_lc', current_rating: 1650.5, highest_rating: 1720, contests_attended: 15 } }
  },

  // --- ANALYTICS ---
  {
    path: '/analytics/student/:studentId',
    method: 'GET',
    module: 'Analytics',
    controller: 'analyticsController.getStudentAnalytics',
    description: 'Retrieves multi-platform aggregate statistics for a student.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'studentId', type: 'integer', description: 'Student ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'object' },
    successCodes: [200],
    errorCodes: [400, 404, 500],
    validation: 'ID validation.',
    tables: ['Users', 'LeetCodeProfiles', 'CodeChefProfiles', 'CodeforcesProfiles', 'HackerRankProfiles', 'Contest_Summary'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { totalSolved: 450, points: 1500, platforms: ['leetcode', 'codeforces'] } }
  },
  {
    path: '/analytics/student/:studentId/rating-history',
    method: 'GET',
    module: 'Analytics',
    controller: 'analyticsController.getStudentRatingHistory',
    description: 'Retrieves time-series rating history for a student across all active platforms.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'studentId', type: 'integer', description: 'Student ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: { leetcode: 'array', codechef: 'array', codeforces: 'array' } },
    successCodes: [200],
    errorCodes: [400, 404, 500],
    validation: 'ID validation.',
    tables: ['LeetCodeProfiles', 'CodeChefProfiles', 'CodeforcesProfiles'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { leetcode: [{ date: '2026-05-15', rating: 1610 }], codeforces: [] } }
  },
  {
    path: '/analytics/student/:studentId/contest-history',
    method: 'GET',
    module: 'Analytics',
    controller: 'analyticsController.getStudentContestHistory',
    description: 'Retrieves individual contest participation records for a student.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'studentId', type: 'integer', description: 'Student ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: [{ id: 'number', contest_slug: 'string', attendance: 'string', rank: 'number', score: 'number' }] },
    successCodes: [200],
    errorCodes: [400, 404, 500],
    validation: 'ID validation.',
    tables: ['Contest_Attendance'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ id: 45, contest_slug: 'weekly-contest-390', attendance: 'PRESENT', rank: 1540, score: 14 }] }
  },
  {
    path: '/analytics/leaderboards',
    method: 'GET',
    module: 'Leaderboard',
    controller: 'analyticsController.getLeaderboards',
    description: 'Retrieves leaderboard rankings filtered by platform, department, section, or batch.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [
      { name: 'platform', type: 'string', description: 'leetcode|codeforces|codechef|hackerrank|all' },
      { name: 'department', type: 'string', description: 'Department code' },
      { name: 'academicBatch', type: 'string', description: 'Academic batch' },
      { name: 'section', type: 'string', description: 'Section' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', leaderboard: [{ rank: 'number', student_name: 'string', roll_no: 'string', rating: 'number', solved: 'number' }] },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Users', 'LeetCodeProfiles', 'CodeChefProfiles', 'CodeforcesProfiles', 'HackerRankProfiles'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, leaderboard: [{ rank: 1, student_name: 'Ganesh Kumar', roll_no: '24IT01', rating: 1950, solved: 780 }] }
  },
  {
    path: '/analytics/departments',
    method: 'GET',
    module: 'Analytics',
    controller: 'analyticsController.getDepartmentAnalytics',
    description: 'Retrieves aggregate coding performance metrics grouped by department.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [{ name: 'academicBatch', type: 'string', description: 'Academic batch filter' }],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: [{ department: 'string', studentCount: 'number', averageSolved: 'number', averageRating: 'number' }] },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Users', 'LeetCodeProfiles', 'CodeChefProfiles', 'CodeforcesProfiles'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ department: 'IT', studentCount: 60, averageSolved: 320, averageRating: 1450 }] }
  },
  {
    path: '/analytics/portal-summary',
    method: 'GET',
    module: 'Dashboard',
    controller: 'analyticsController.getPortalSummary',
    description: 'Retrieves high-level summary stats for landing dashboards.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [
      { name: 'department', type: 'string', description: 'Filter by department' },
      { name: 'academicBatch', type: 'string', description: 'Filter by academic batch' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: { totalStudents: 'number', activePlatformsCount: 'number', averageAttendance: 'number', topPerformersCount: 'number' } },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Users', 'Contest_Attendance'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { totalStudents: 345, activePlatformsCount: 4, averageAttendance: 78.4, topPerformersCount: 24 } }
  },
  {
    path: '/analytics/rating-distribution',
    method: 'GET',
    module: 'Analytics',
    controller: 'analyticsController.getRatingDistribution',
    description: 'Gets distribution of student ratings in bands (e.g. <1200, 1200-1400, etc.) for histogram visualization.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [
      { name: 'platform', type: 'string', description: 'leetcode|codeforces|codechef' },
      { name: 'department', type: 'string', description: 'Department code' },
      { name: 'academicBatch', type: 'string', description: 'Academic batch' },
      { name: 'section', type: 'string', description: 'Section' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: [{ band: 'string', count: 'number' }] },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['LeetCodeProfiles', 'CodeChefProfiles', 'CodeforcesProfiles', 'Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ band: '1400-1600', count: 42 }] }
  },

  // --- ATTENDANCE ---
  {
    path: '/attendance/upload',
    method: 'POST',
    module: 'Attendance',
    controller: 'attendanceController.processContestUpload',
    description: 'Processes a manual contest standing file (Excel/CSV) and marks attendance.',
    auth: 'No',
    headers: ['Content-Type: multipart/form-data'],
    pathParams: [],
    queryParams: [],
    bodySchema: { file: 'file (binary, required)', contestName: 'string (required)', contestDate: 'string (YYYY-MM-DD, required)', contestSlug: 'string (optional)' },
    responseSchema: { success: 'boolean', message: 'string', processedRecords: 'number' },
    successCodes: [200],
    errorCodes: [400, 500],
    validation: 'Verifies file payload and fields.',
    tables: ['Contests', 'Contest_Attendance', 'Users'],
    middlewares: ['multerMiddleware'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Contest upload processed successfully. 45 records loaded.', processedRecords: 45 }
  },
  {
    path: '/attendance/override',
    method: 'POST',
    module: 'Attendance',
    controller: 'attendanceController.overrideAttendance',
    description: 'Manually overrides attendance status for a student on a specific contest.',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [],
    queryParams: [],
    bodySchema: { studentId: 'number (required)', contestSlug: 'string (required)', attendanceStatus: 'string (PRESENT|ABSENT, required)', remarks: 'string' },
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 500],
    validation: 'Validates presence of fields and attendance status enum values.',
    tables: ['Contest_Attendance', 'Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { studentId: 10, contestSlug: 'weekly-contest-390', attendanceStatus: 'PRESENT', remarks: 'Medical leave approved' },
    exampleResponse: { success: true, message: 'Attendance override successfully applied.' }
  },
  {
    path: '/attendance/contest/:contestId',
    method: 'GET',
    module: 'Attendance',
    controller: 'attendanceController.getContestAttendance',
    description: 'Retrieves attendance list for a specific contest with pagination and filters.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'contestId', type: 'integer/string', description: 'Contest ID or Slug' }],
    queryParams: [
      { name: 'page', type: 'integer', description: 'Page number' },
      { name: 'limit', type: 'integer', description: 'Limit count' },
      { name: 'status', type: 'string', description: 'Filter by PRESENT|ABSENT' },
      { name: 'department', type: 'string', description: 'Filter by department' },
      { name: 'section', type: 'string', description: 'Filter by section' },
      { name: 'batch', type: 'string', description: 'Filter by batch' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', contest: 'object', attendance: 'array', pagination: 'object' },
    successCodes: [200],
    errorCodes: [404, 500],
    validation: 'Validates contestId parameter.',
    tables: ['Contests', 'Contest_Attendance', 'Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, contest: { title: 'Weekly Contest 390' }, attendance: [{ student_name: 'John Doe', roll_no: '24CS01', attendance: 'PRESENT' }] }
  },
  {
    path: '/attendance/student/:studentId',
    method: 'GET',
    module: 'Attendance',
    controller: 'attendanceController.getStudentAttendanceHistory',
    description: 'Retrieves detailed attendance history and summary percentages for a student.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'studentId', type: 'integer', description: 'Student ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', summary: 'object', history: 'array' },
    successCodes: [200],
    errorCodes: [404, 500],
    validation: 'ID check.',
    tables: ['Contest_Attendance', 'Contest_Summary'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, summary: { total: 10, attended: 8, percentage: 80 }, history: [{ contest_slug: 'weekly-contest-390', attendance: 'PRESENT' }] }
  },
  {
    path: '/attendance/leetcode-sync',
    method: 'POST',
    module: 'Contest Synchronization',
    controller: 'leetcodeContestAttendanceController.syncContest',
    description: 'Synchronizes and updates attendance for a specific LeetCode contest slug by searching rankings (Super Admin only).',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>', 'Content-Type: application/json'],
    pathParams: [],
    queryParams: [],
    bodySchema: { contestSlug: 'string (required)' },
    responseSchema: { success: 'boolean', message: 'string', data: 'object' },
    successCodes: [200],
    errorCodes: [400, 401, 403, 500],
    validation: 'Requires Super Admin. Verifies contestSlug presence.',
    tables: ['Contests', 'ContestParticipants', 'ContestLeaderboardSnapshots', 'contest_attendance', 'Users'],
    middlewares: ['authenticate', 'authorize(["Super Admin"])'],
    externalApis: 'LeetCode',
    cache: 'No',
    job: 'No',
    exampleRequest: { contestSlug: 'weekly-contest-390' },
    exampleResponse: { success: true, message: "Successfully synchronized attendance for contest 'weekly-contest-390'!" }
  },
  {
    path: '/attendance/leetcode-stats',
    method: 'GET',
    module: 'Attendance',
    controller: 'leetcodeContestAttendanceController.getStatsAndRecords',
    description: 'Gets individual records and stats for a specific contest standing sync.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [
      { name: 'contestSlug', type: 'string', description: 'Contest slug (required)' },
      { name: 'department', type: 'string', description: 'Department code' },
      { name: 'batch', type: 'string', description: 'Academic batch' },
      { name: 'section', type: 'string', description: 'Section' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', stats: 'object', records: 'array' },
    successCodes: [200],
    errorCodes: [400, 401, 403, 500],
    validation: 'Requires Super Admin, Faculty, or HOD. Checks contestSlug parameter.',
    tables: ['contest_attendance', 'Users'],
    middlewares: ['authenticate', 'authorize(["Super Admin", "Faculty", "HOD"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, stats: { totalRegistered: 60, present: 45 }, records: [] }
  },

  // --- CONTEST SYNCHRONIZATION ---
  {
    path: '/contest/sync/:contestSlug',
    method: 'POST',
    module: 'Contest Synchronization',
    controller: 'contestLeaderboardSyncController.startSync',
    description: 'Triggers programmatic background leaderboard sync from LeetCode GraphQL APIs.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'contestSlug', type: 'string', description: 'LeetCode contest slug' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string', jobId: 'string' },
    successCodes: [202],
    errorCodes: [400, 500],
    validation: 'Slug presence validation.',
    tables: ['Contests', 'ContestSyncLog'],
    middlewares: [],
    externalApis: 'LeetCode',
    cache: 'No',
    job: 'Yes',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Synchronization job queued.', jobId: 'sync-lc-weekly-390' }
  },
  {
    path: '/contest/sync/status/:jobId',
    method: 'GET',
    module: 'Contest Synchronization',
    controller: 'contestLeaderboardSyncController.getSyncStatus',
    description: 'Polls status of a queued leaderboard sync job.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'jobId', type: 'string', description: 'Job ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', job: { id: 'string', status: 'string', progress: 'number', error: 'string|null' } },
    successCodes: [200],
    errorCodes: [404, 500],
    validation: 'Job ID presence validation.',
    tables: [],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, job: { id: 'sync-lc-weekly-390', status: 'processing', progress: 65, error: null } }
  },
  {
    path: '/contest/sync/cancel/:jobId',
    method: 'POST',
    module: 'Contest Synchronization',
    controller: 'contestLeaderboardSyncController.cancelSync',
    description: 'Cancels a pending or processing leaderboard sync job.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'jobId', type: 'string', description: 'Job ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 404, 500],
    validation: 'Job ID validation.',
    tables: [],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Sync job cancelled successfully.' }
  },
  {
    path: '/contest/sync/retry/:jobId',
    method: 'POST',
    module: 'Contest Synchronization',
    controller: 'contestLeaderboardSyncController.retrySync',
    description: 'Retries a failed or cancelled leaderboard sync job.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'jobId', type: 'string', description: 'Job ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string', jobId: 'string' },
    successCodes: [202],
    errorCodes: [400, 404, 500],
    validation: 'Job ID validation.',
    tables: [],
    middlewares: [],
    externalApis: 'LeetCode',
    cache: 'No',
    job: 'Yes',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Retry job queued.', jobId: 'sync-lc-weekly-390-retry' }
  },
  {
    path: '/contest/sync/history',
    method: 'GET',
    module: 'Contest Synchronization',
    controller: 'contestLeaderboardSyncController.getSyncHistory',
    description: 'Fetches sync log history from database logs.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', history: [{ id: 'number', contest_slug: 'string', status: 'string', started_at: 'string', completed_at: 'string' }] },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['ContestSyncLog'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, history: [{ id: 1, contest_slug: 'weekly-contest-390', status: 'completed', started_at: '2026-06-30T05:00:00Z', completed_at: '2026-06-30T05:02:00Z' }] }
  },

  // --- CONTESTMASTER (Leaderboard/Analytics) ---
  {
    path: '/contestmaster/batches',
    method: 'GET',
    module: 'Leaderboard',
    controller: 'contestmasterController.getContestMasterBatches',
    description: 'Retrieves batches configured for coding contests.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'array' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Contests'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: ['2024-2028', '2023-2027'] }
  },
  {
    path: '/contestmaster/live/current',
    method: 'GET',
    module: 'Leaderboard',
    controller: 'contestmasterController.getLiveCurrent',
    description: 'Gets details of currently ongoing live contests.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'object' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['LiveContests'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { contestSlug: 'weekly-contest-399', isLive: true } }
  },
  {
    path: '/contestmaster/live/students',
    method: 'GET',
    module: 'Leaderboard',
    controller: 'contestmasterController.getLiveStudents',
    description: 'Retrieves live standings of students participating in current contest.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'array' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['ContestAttendance', 'Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ studentName: 'John', rank: 450 }] }
  },
  {
    path: '/contestmaster/live/analytics',
    method: 'GET',
    module: 'Leaderboard',
    controller: 'contestmasterController.getLiveAnalytics',
    description: 'Retrieves analytics for the live contest.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'object' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['ContestAttendance'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { presentCount: 45, absentCount: 15 } }
  },
  {
    path: '/contestmaster/live/health',
    method: 'GET',
    module: 'Leaderboard',
    controller: 'contestmasterController.getLiveHealth',
    description: 'Retrieves crawler system and API latency status for the live tracker.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'object' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: [],
    middlewares: [],
    externalApis: 'LeetCode',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { status: 'healthy', apiLatencyMs: 120 } }
  },
  {
    path: '/contestmaster/live/stream',
    method: 'GET',
    module: 'Leaderboard',
    controller: 'contestmasterController.getLiveStream',
    description: 'Establishes a Server-Sent Events (SSE) connection for real-time standing updates.',
    auth: 'No',
    headers: ['Accept: text/event-stream'],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: 'text/event-stream response',
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: [],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: null
  },
  {
    path: '/contestmaster/live/control',
    method: 'POST',
    module: 'Leaderboard',
    controller: 'contestmasterController.triggerLiveControl',
    description: 'Issues manual commands to live scheduler (start/pause/stop sync).',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [],
    queryParams: [],
    bodySchema: { action: 'string (start|pause|resume|stop, required)' },
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 500],
    validation: 'Checks presence of action parameter.',
    tables: [],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { action: 'stop' },
    exampleResponse: { success: true, message: 'Live scheduler stopped successfully.' }
  },
  {
    path: '/contestmaster/:platform',
    method: 'GET',
    module: 'Leaderboard',
    controller: 'contestmasterController.getPlatformAnalytics',
    description: 'Gets aggregates and ranking details for contests on a specific platform.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'platform', type: 'string', description: 'leetcode|codeforces|codechef|hackerrank' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'object' },
    successCodes: [200],
    errorCodes: [400, 500],
    validation: 'Platform parameter check.',
    tables: ['Contests', 'Contest_Attendance'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { platformName: 'leetcode', totalContestsTracked: 154 } }
  },

  // --- CONTESTS (Contest History) ---
  {
    path: '/contests/',
    method: 'GET',
    module: 'Contest History',
    controller: 'contestController.getContests',
    description: 'Retrieves a list of all tracked contests.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [
      { name: 'page', type: 'integer' },
      { name: 'limit', type: 'integer' },
      { name: 'contest_type', type: 'string' },
      { name: 'contest_status', type: 'string' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: [{ contest_id: 'number', title: 'string', slug: 'string', start_time: 'string' }], pagination: 'object' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Contests'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ contest_id: 1, title: 'Weekly Contest 390', slug: 'weekly-contest-390', start_time: '2026-03-24T08:00:00.000Z' }] }
  },
  {
    path: '/contests/',
    method: 'POST',
    module: 'Contest History',
    controller: 'contestController.addContest',
    description: 'Registers a new contest in system master records.',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [],
    queryParams: [],
    bodySchema: { title: 'string (required)', slug: 'string (required, unique)', contest_type: 'string (Weekly|Biweekly, required)', contest_number: 'number (required)', start_time: 'string (YYYY-MM-DD HH:mm:ss, required)', duration: 'number', contest_status: 'string (Rated|Unrated)' },
    responseSchema: { success: 'boolean', message: 'string', contestId: 'number' },
    successCodes: [201],
    errorCodes: [400, 500],
    validation: 'Verifies core contest parameters are present.',
    tables: ['Contests'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { title: 'Weekly Contest 400', slug: 'weekly-contest-400', contest_type: 'Weekly', contest_number: 400, start_time: '2026-07-02 08:00:00' },
    exampleResponse: { success: true, message: 'Contest registered successfully.', contestId: 35 }
  },
  {
    path: '/contests/:id',
    method: 'PUT',
    module: 'Contest History',
    controller: 'contestController.editContest',
    description: 'Updates details of a registered contest.',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [{ name: 'id', type: 'integer', description: 'Contest ID' }],
    queryParams: [],
    bodySchema: { title: 'string', start_time: 'string', duration: 'number', contest_status: 'string' },
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 404, 500],
    validation: 'Checks contest ID.',
    tables: ['Contests'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { title: 'Weekly Contest 400 (Updated)' },
    exampleResponse: { success: true, message: 'Contest updated successfully.' }
  },
  {
    path: '/contests/:id',
    method: 'DELETE',
    module: 'Contest History',
    controller: 'contestController.deleteContest',
    description: 'Deletes a contest and its standings logs.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'id', type: 'integer', description: 'Contest ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 404, 500],
    validation: 'Checks contest ID.',
    tables: ['Contests', 'Contest_Attendance', 'Contest_Participants'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Contest and related attendance records purged.' }
  },
  {
    path: '/contests/register',
    method: 'POST',
    module: 'Contest History',
    controller: 'contestController.registerContest',
    description: 'Registers a student enrollment for tracking standings.',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [],
    queryParams: [],
    bodySchema: { contestId: 'number (required)', studentId: 'number (required)' },
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 500],
    validation: 'Checks IDs exist.',
    tables: ['Registrations'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { contestId: 1, studentId: 10 },
    exampleResponse: { success: true, message: 'Student successfully registered for contest.' }
  },
  {
    path: '/contests/join',
    method: 'POST',
    module: 'Contest History',
    controller: 'contestController.joinContest',
    description: 'Logs student participation check-in.',
    auth: 'No',
    headers: ['Content-Type: application/json'],
    pathParams: [],
    queryParams: [],
    bodySchema: { contestId: 'number (required)', studentId: 'number (required)' },
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [400, 500],
    validation: 'Checks IDs exist.',
    tables: ['ParticipationLogs'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: { contestId: 1, studentId: 10 },
    exampleResponse: { success: true, message: 'Participation record logged.' }
  },
  {
    path: '/contests/sync',
    method: 'POST',
    module: 'Contest Synchronization',
    controller: 'contestController.triggerSync',
    description: 'Manually triggers automated scheduler sync logs generation.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['sync_logs'],
    middlewares: [],
    externalApis: 'LeetCode, Codeforces, CodeChef',
    cache: 'No',
    job: 'Yes',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Sync process manually triggered.' }
  },
  {
    path: '/contests/sync-logs',
    method: 'GET',
    module: 'Contest History',
    controller: 'contestController.getSyncLogs',
    description: 'Retrieves background crawler execution logs.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', logs: 'array' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['sync_logs'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, logs: [{ status: 'success', contests_synced: 1 }] }
  },

  // --- HEALTH ---
  {
    path: '/health/',
    method: 'GET',
    module: 'Health',
    controller: 'healthController.getSystemHealth',
    description: 'Comprehensive health check (DB connectivity, memory, jobs, platform status).',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { status: 'string', database: 'object', cpu: 'object', memory: 'object', platforms: 'object' },
    successCodes: [200, 503],
    errorCodes: [],
    validation: 'None.',
    tables: ['Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { status: 'healthy', database: { connected: true }, cpu: { usagePercent: 2.1 } }
  },
  {
    path: '/health/system',
    method: 'GET',
    module: 'Health',
    controller: 'healthController.getSystemHealth',
    description: 'System health check alias endpoint (Duplicate route).',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { status: 'string', database: 'object', cpu: 'object', memory: 'object', platforms: 'object' },
    successCodes: [200, 503],
    errorCodes: [],
    validation: 'None.',
    tables: ['Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { status: 'healthy', database: { connected: true } }
  },
  {
    path: '/health/migrations',
    method: 'GET',
    module: 'Health',
    controller: 'healthController.getMigrationHealth',
    description: 'Checks database migrations health and mismatch logs (Super Admin/HOD only).',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', migrationHealth: 'array', executedMigrations: 'array', issues: 'array' },
    successCodes: [200],
    errorCodes: [401, 403, 500],
    validation: 'Requires Super Admin or HOD roles.',
    tables: ['Migration_Health', 'Schema_Migrations', 'Attendance_Migration_Issues'],
    middlewares: ['authenticate', 'authorize(["Super Admin", "HOD"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, migrationHealth: [], executedMigrations: [], issues: [] }
  },
  {
    path: '/health/platform',
    method: 'GET',
    module: 'Health',
    controller: 'healthController.getPlatformHealth',
    description: 'Checks status and API latency of coding platforms (LeetCode, HackerRank, Codeforces, CodeChef).',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'object' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: [],
    middlewares: [],
    externalApis: 'LeetCode, Codeforces, CodeChef, HackerRank',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { leetcode: { status: 'operational', latencyMs: 250 } } }
  },
  {
    path: '/health/platform/:platform',
    method: 'GET',
    module: 'Health',
    controller: 'healthController.getPlatformHealth',
    description: 'Checks status and latency of a specific coding platform.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'platform', type: 'string', description: 'leetcode|codeforces|codechef|hackerrank' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'object' },
    successCodes: [200],
    errorCodes: [404, 500],
    validation: 'Platform parameter check.',
    tables: [],
    middlewares: [],
    externalApis: 'LeetCode, Codeforces, CodeChef, HackerRank',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { status: 'operational', latencyMs: 250 } }
  },

  // --- JOBS (Admin) ---
  {
    path: '/jobs/',
    method: 'GET',
    module: 'Admin',
    controller: 'jobController.listJobs',
    description: 'Lists all background jobs in the scheduler queues.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [
      { name: 'status', type: 'string', description: 'Filter by job status' },
      { name: 'page', type: 'integer' },
      { name: 'limit', type: 'integer' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'array', pagination: 'object' },
    successCodes: [200],
    errorCodes: [401, 500],
    validation: 'Allows role-based view of jobs.',
    tables: [],
    middlewares: ['authenticate', 'authorize(["Super Admin", "HOD", "Faculty", "Placement Coordinator", "Student"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ id: 'job-1', type: 'recalc', status: 'completed' }] }
  },
  {
    path: '/jobs/cache',
    method: 'GET',
    module: 'Cache',
    controller: 'jobController.getCacheStats',
    description: 'Retrieves analytical cache utilization stats and hits/misses keys count.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', cache: { size: 'number', hits: 'number', misses: 'number' } },
    successCodes: [200],
    errorCodes: [401, 403, 500],
    validation: 'Role verification.',
    tables: [],
    middlewares: ['authenticate', 'authorize(["Super Admin", "HOD", "Faculty"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, cache: { size: 12, hits: 1450, misses: 200 } }
  },
  {
    path: '/jobs/cache/invalidate',
    method: 'POST',
    module: 'Cache',
    controller: 'jobController.invalidateCache',
    description: 'Invalidates all analytical and report caches.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [401, 403, 500],
    validation: 'Role checks.',
    tables: ['AuditLog'],
    middlewares: ['authenticate', 'authorize(["Super Admin", "HOD", "Faculty"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Analytics cache cleared successfully' }
  },
  {
    path: '/jobs/sync',
    method: 'POST',
    module: 'Contest Synchronization',
    controller: 'jobController.triggerSyncJob',
    description: 'Triggers platform sync job.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string', jobId: 'string' },
    successCodes: [202],
    errorCodes: [401, 403, 500],
    validation: 'Role checks.',
    tables: [],
    middlewares: ['authenticate', 'authorize(["Super Admin", "HOD", "Faculty"])'],
    externalApis: 'LeetCode, Codeforces, CodeChef, HackerRank',
    cache: 'No',
    job: 'Yes',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Sync job triggered', jobId: 'job-sync-123' }
  },
  {
    path: '/jobs/analytics-recalc',
    method: 'POST',
    module: 'Admin',
    controller: 'jobController.triggerAnalyticsRecalc',
    description: 'Recalculates aggregate analytics metrics for students.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string', jobId: 'string' },
    successCodes: [202],
    errorCodes: [401, 403, 500],
    validation: 'Role checks.',
    tables: ['Contest_Summary'],
    middlewares: ['authenticate', 'authorize(["Super Admin", "HOD", "Faculty"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'Yes',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Analytics recalculation job triggered', jobId: 'job-recalc-123' }
  },
  {
    path: '/jobs/export',
    method: 'POST',
    module: 'Admin',
    controller: 'jobController.triggerExportJob',
    description: 'Generates reports and exports Excel files in background.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [],
    bodySchema: { exportType: 'string (required)', filters: 'object' },
    responseSchema: { success: 'boolean', message: 'string', jobId: 'string' },
    successCodes: [202],
    errorCodes: [400, 401, 403, 500],
    validation: 'Checks exportType.',
    tables: [],
    middlewares: ['authenticate', 'authorize(["Super Admin", "HOD", "Faculty", "Placement Coordinator"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'Yes',
    exampleRequest: { exportType: 'student-analytics', filters: { department: 'CSE' } },
    exampleResponse: { success: true, message: 'Export job triggered', jobId: 'job-export-123' }
  },
  {
    path: '/jobs/backfill',
    method: 'POST',
    module: 'Admin',
    controller: 'jobController.triggerAttendanceBackfill',
    description: 'Triggers attendance record backfilling based on history data.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string', jobId: 'string' },
    successCodes: [202],
    errorCodes: [401, 403, 500],
    validation: 'Role checks.',
    tables: ['Contest_Attendance'],
    middlewares: ['authenticate', 'authorize(["Super Admin", "HOD", "Faculty"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'Yes',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Attendance backfill job triggered', jobId: 'job-backfill-123' }
  },
  {
    path: '/jobs/:id/download',
    method: 'GET',
    module: 'Admin',
    controller: 'jobController.downloadJobFile',
    description: 'Downloads the output file generated by a background export job.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [{ name: 'id', type: 'string', description: 'Job ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: 'binary file response',
    successCodes: [200],
    errorCodes: [401, 403, 404, 500],
    validation: 'Job ID check.',
    tables: [],
    middlewares: ['authenticate', 'authorize(["Super Admin", "HOD", "Faculty", "Placement Coordinator", "Student"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: null
  },
  {
    path: '/jobs/:id',
    method: 'GET',
    module: 'Admin',
    controller: 'jobController.getJob',
    description: 'Retrieves execution detail and progress status of a job.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [{ name: 'id', type: 'string', description: 'Job ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'object' },
    successCodes: [200],
    errorCodes: [401, 404, 500],
    validation: 'Checks job ID.',
    tables: [],
    middlewares: ['authenticate', 'authorize(["Super Admin", "HOD", "Faculty", "Placement Coordinator", "Student"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { id: 'job-export-123', status: 'completed', progress: 100 } }
  },
  {
    path: '/jobs/:id/cancel',
    method: 'POST',
    module: 'Admin',
    controller: 'jobController.cancelJob',
    description: 'Cancels a pending or processing background job.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [{ name: 'id', type: 'string', description: 'Job ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [401, 403, 404, 500],
    validation: 'Checks job ID.',
    tables: [],
    middlewares: ['authenticate', 'authorize(["Super Admin", "HOD", "Faculty"])'],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Job cancelled successfully.' }
  },

  // --- NOTIFICATIONS ---
  {
    path: '/notifications/',
    method: 'GET',
    module: 'Other',
    controller: 'notificationController.getNotifications',
    description: 'Retrieves notifications with optional read status filters and pagination.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [
      { name: 'is_read', type: 'boolean' },
      { name: 'page', type: 'integer' },
      { name: 'limit', type: 'integer' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'array', pagination: 'object' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['notifications'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ id: 1, title: 'Low Attendance', message: 'Attendance below 75%' }] }
  },
  {
    path: '/notifications/count',
    method: 'GET',
    module: 'Other',
    controller: 'notificationController.getUnreadCount',
    description: 'Gets count of unread notifications.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', unreadCount: 'number' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['notifications'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, unreadCount: 5 }
  },
  {
    path: '/notifications/read/:id',
    method: 'POST',
    module: 'Other',
    controller: 'notificationController.markAsRead',
    description: 'Marks a notification as read.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'id', type: 'integer', description: 'Notification ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [404, 500],
    validation: 'ID validation.',
    tables: ['notifications'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Notification marked as read.' }
  },
  {
    path: '/notifications/read-all',
    method: 'POST',
    module: 'Other',
    controller: 'notificationController.markAllAsRead',
    description: 'Marks all notifications in database as read.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['notifications'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'All notifications marked as read.' }
  },
  {
    path: '/notifications/archive/:id',
    method: 'POST',
    module: 'Other',
    controller: 'notificationController.archiveNotification',
    description: 'Archives (deletes) a notification.',
    auth: 'No',
    headers: [],
    pathParams: [{ name: 'id', type: 'integer', description: 'Notification ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', message: 'string' },
    successCodes: [200],
    errorCodes: [404, 500],
    validation: 'ID validation.',
    tables: ['notifications'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, message: 'Notification archived successfully.' }
  },

  // --- PLACEMENT (Analytics) ---
  {
    path: '/placement/student/:studentId',
    method: 'GET',
    module: 'Analytics',
    controller: 'placementController.getStudentPlacementData',
    description: 'Retrieves placement readiness details for a specific student.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [{ name: 'studentId', type: 'integer', description: 'Student ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'object' },
    successCodes: [200],
    errorCodes: [400, 401, 403, 404, 500],
    validation: 'ID check and role authorization (Students can only see their own profile).',
    tables: ['Users', 'Contest_Summary', 'LeetCodeProfiles'],
    middlewares: ['authenticate'],
    externalApis: 'None',
    cache: 'Yes',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { leetcodeVerified: true, solvesCount: 320, placementReady: true } }
  },
  {
    path: '/placement/overview',
    method: 'GET',
    module: 'Analytics',
    controller: 'placementController.getPlacementOverview',
    description: 'Retrieves aggregate placement statistics (Admin/Faculty only).',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [],
    queryParams: [
      { name: 'department', type: 'string' },
      { name: 'academicBatch', type: 'string' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', totalStudentsCount: 'number', placementReadyCount: 'number', percentage: 'number' },
    successCodes: [200],
    errorCodes: [401, 403, 500],
    validation: 'Role checks (Students are forbidden).',
    tables: ['Users', 'Contest_Summary'],
    middlewares: ['authenticate'],
    externalApis: 'None',
    cache: 'Yes',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, totalStudentsCount: 150, placementReadyCount: 120, percentage: 80.0 }
  },

  // --- REPORTS ---
  {
    path: '/reports/dashboard-stats',
    method: 'GET',
    module: 'Dashboard',
    controller: 'reportController.getDashboardStats',
    description: 'Gets summary aggregates for dashboard cards.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', totalStudents: 'number', avgAttendance: 'number' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Users', 'Contest_Attendance'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, totalStudents: 345, avgAttendance: 78.5 }
  },
  {
    path: '/reports/contests',
    method: 'GET',
    module: 'Reports',
    controller: 'reportController.getContestsReport',
    description: 'Retrieves detailed report on tracked contests.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [
      { name: 'department', type: 'string' },
      { name: 'academicBatch', type: 'string' },
      { name: 'section', type: 'string' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'array' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Contests', 'Contest_Attendance'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ contestSlug: 'weekly-contest-390', presentCount: 45 }] }
  },
  {
    path: '/reports/students',
    method: 'GET',
    module: 'Reports',
    controller: 'reportController.getStudentsReport',
    description: 'Retrieves attendance and solving summaries per student.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [
      { name: 'department', type: 'string' },
      { name: 'academicBatch', type: 'string' },
      { name: 'section', type: 'string' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'array' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Users', 'Contest_Summary'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ name: 'John Doe', roll_no: '24CS01', totalSolved: 320, percentage: 80.0 }] }
  },
  {
    path: '/reports/departments',
    method: 'GET',
    module: 'Reports',
    controller: 'reportController.getDepartmentReport',
    description: 'Retrieves comparative department metrics report.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [{ name: 'academicBatch', type: 'string' }],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'array' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Users', 'Contest_Summary'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ department: 'CSE', averageSolved: 280 }] }
  },
  {
    path: '/reports/sections',
    method: 'GET',
    module: 'Reports',
    controller: 'reportController.getSectionReport',
    description: 'Retrieves sections comparative metrics report.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [
      { name: 'department', type: 'string' },
      { name: 'academicBatch', type: 'string' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'array' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Users', 'Contest_Summary'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: [{ section: 'A', averageSolved: 340 }] }
  },
  {
    path: '/reports/heatmap',
    method: 'GET',
    module: 'Reports',
    controller: 'reportController.getAttendanceHeatmap',
    description: 'Retrieves student contest attendance density over time.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [
      { name: 'department', type: 'string' },
      { name: 'academicBatch', type: 'string' },
      { name: 'section', type: 'string' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', heatmap: 'array' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Contest_Attendance', 'Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, heatmap: [{ date: '2026-06-28', presentCount: 45 }] }
  },
  {
    path: '/reports/attendance-log',
    method: 'GET',
    module: 'Reports',
    controller: 'reportController.getAttendanceLog',
    description: 'Retrieves chronological list of all attendance changes.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [
      { name: 'department', type: 'string' },
      { name: 'academicBatch', type: 'string' },
      { name: 'section', type: 'string' },
      { name: 'page', type: 'integer' },
      { name: 'limit', type: 'integer' }
    ],
    bodySchema: null,
    responseSchema: { success: 'boolean', logs: 'array', pagination: 'object' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Contest_Attendance', 'Users'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, logs: [{ name: 'John Doe', contest: 'weekly-contest-390', action: 'PRESENT_AUTO' }] }
  },
  {
    path: '/reports/faculty-summary',
    method: 'GET',
    module: 'Reports',
    controller: 'reportController.getFacultySummary',
    description: 'Retrieves summary statistics targeted for HOD/Faculty members.',
    auth: 'No',
    headers: [],
    pathParams: [],
    queryParams: [{ name: 'department', type: 'string' }],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: 'object' },
    successCodes: [200],
    errorCodes: [500],
    validation: 'None.',
    tables: ['Users', 'Contest_Summary'],
    middlewares: [],
    externalApis: 'None',
    cache: 'No',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { department: 'IT', totalStudentsCount: 60 } }
  },

  // --- AI INSIGHTS (Analytics) ---
  {
    path: '/ai/insights/:studentId',
    method: 'GET',
    module: 'Analytics',
    controller: 'aiController.getStudentAiInsights',
    description: 'Retrieves personalized AI coaching insights, performance forecasts, and alerts for a student profile.',
    auth: 'Yes',
    headers: ['Authorization: Bearer <token>'],
    pathParams: [{ name: 'studentId', type: 'integer', description: 'Student ID' }],
    queryParams: [],
    bodySchema: null,
    responseSchema: { success: 'boolean', data: { studentId: 'number', insights: 'array', predictedScore: 'number', warnings: 'array' } },
    successCodes: [200],
    errorCodes: [400, 401, 403, 404, 500],
    validation: 'ID validation and role authorization (Students can only query their own ID).',
    tables: ['Users', 'Contest_Summary', 'Contest_Attendance'],
    middlewares: ['authenticate'],
    externalApis: 'None',
    cache: 'Yes',
    job: 'No',
    exampleRequest: null,
    exampleResponse: { success: true, data: { studentId: 10, insights: ['Solves are consistent', 'Focus on Medium problems'], predictedScore: 1680.0, warnings: [] } }
  }
];

// Helper to determine route file name
function getRouteFile(pathStr) {
  if (pathStr.startsWith('/auth/')) return 'auth';
  if (pathStr.startsWith('/departments/')) return 'departments';
  if (pathStr.startsWith('/students/')) return 'students';
  if (pathStr.startsWith('/analytics/')) return 'analytics';
  if (pathStr.startsWith('/attendance/')) return 'attendance';
  if (pathStr.startsWith('/contest/sync')) return 'contestLeaderboardSync';
  if (pathStr.startsWith('/contestmaster/')) return 'contestmaster';
  if (pathStr.startsWith('/contests/')) return 'contests';
  if (pathStr.startsWith('/health/')) return 'health';
  if (pathStr.startsWith('/jobs/')) return 'jobs';
  if (pathStr.startsWith('/notifications/')) return 'notifications';
  if (pathStr.startsWith('/placement/')) return 'placement';
  if (pathStr.startsWith('/reports/')) return 'reports';
  if (pathStr.startsWith('/ai/')) return 'ai';
  return 'unknown';
}

// Generate all 90 endpoints (combining /api/ and /api/v1/ variants)
const allEndpoints = [];
uniqueEndpoints.forEach(item => {
  const routeFile = getRouteFile(item.path);
  // /api/ endpoint
  allEndpoints.push({
    ...item,
    routeFile,
    fullUrl: `/api${item.path}`
  });
  // /api/v1/ endpoint
  allEndpoints.push({
    ...item,
    routeFile,
    fullUrl: `/api/v1${item.path}`
  });
});

// Sort endpoints by URL path and HTTP Method for cleaner tables
allEndpoints.sort((a, b) => {
  const pathComp = a.fullUrl.localeCompare(b.fullUrl);
  if (pathComp !== 0) return pathComp;
  return a.method.localeCompare(b.method);
});

// Calculate statistics
const totalApis = allEndpoints.length;
const getCount = allEndpoints.filter(e => e.method === 'GET').length;
const postCount = allEndpoints.filter(e => e.method === 'POST').length;
const putPatchCount = allEndpoints.filter(e => e.method === 'PUT' || e.method === 'PATCH').length;
const deleteCount = allEndpoints.filter(e => e.method === 'DELETE').length;

// Group APIs by Module
const grouped = {};
allEndpoints.forEach(e => {
  if (!grouped[e.module]) {
    grouped[e.module] = [];
  }
  grouped[e.module].push(e);
});

// --- GENERATE POSTMAN COLLECTION ---
const postmanCollection = {
  info: {
    name: 'EnthraHub Faculty Analytics System API',
    description: 'Postman Collection generated dynamically from backend code audit mapping all 90 endpoints.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  item: []
};

// We group Postman folders by Module for clean organization
const modules = [...new Set(uniqueEndpoints.map(e => e.module))].sort();
modules.forEach(modName => {
  const folder = {
    name: modName,
    item: []
  };

  const modEndpoints = uniqueEndpoints.filter(e => e.module === modName);
  modEndpoints.forEach(ep => {
    // Generate both v1 and base items in the folder
    ['/api', '/api/v1'].forEach(prefix => {
      const fullPath = `${prefix}${ep.path}`;
      const urlTokens = fullPath.split('/').filter(Boolean);
      
      const postmanItem = {
        name: `${ep.method} ${fullPath}`,
        request: {
          method: ep.method,
          header: [],
          url: {
            raw: `{{baseUrl}}${fullPath}`,
            host: ['{{baseUrl}}'],
            path: urlTokens
          },
          description: ep.description
        },
        response: []
      };

      // Add Headers
      if (ep.auth === 'Yes') {
        postmanItem.request.header.push({
          key: 'Authorization',
          value: 'Bearer {{token}}',
          type: 'text'
        });
      }
      ep.headers.forEach(h => {
        const [k, v] = h.split(': ');
        if (k !== 'Authorization') {
          postmanItem.request.header.push({
            key: k,
            value: v || '',
            type: 'text'
          });
        }
      });

      // Add Query Parameters
      if (ep.queryParams.length > 0) {
        postmanItem.request.url.query = ep.queryParams.map(q => ({
          key: q.name,
          value: `{{${q.name}}}`,
          description: q.description
        }));
      }

      // Add request body if POST/PUT
      if (ep.bodySchema && (ep.method === 'POST' || ep.method === 'PUT')) {
        postmanItem.request.body = {
          mode: 'raw',
          raw: JSON.stringify(ep.exampleRequest || {}, null, 2),
          options: {
            raw: {
              language: 'json'
            }
          }
        };
      }

      folder.item.push(postmanItem);
    });
  });

  postmanCollection.item.push(folder);
});

fs.writeFileSync(
  path.join(ARTIFACT_DIR, 'postman_collection.json'),
  JSON.stringify(postmanCollection, null, 2)
);

// --- GENERATE OPENAPI SPEC ---
const openapi = {
  openapi: '3.0.0',
  info: {
    title: 'EnthraHub Faculty Analytics System API',
    description: 'OpenAPI Swagger specification mapping all 90 endpoints in the system.',
    version: '1.0.0'
  },
  servers: [
    { url: 'http://localhost:5000', description: 'Local Development Server' }
  ],
  paths: {}
};

// Populate paths in OpenAPI
allEndpoints.forEach(ep => {
  // Convert express path params (e.g. :id) to swagger brackets (e.g. {id})
  const swaggerPath = ep.fullUrl.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
  
  if (!openapi.paths[swaggerPath]) {
    openapi.paths[swaggerPath] = {};
  }

  const methodLower = ep.method.toLowerCase();
  
  // Build operation
  const operation = {
    tags: [ep.module],
    summary: ep.description.split('.')[0] + '.',
    description: ep.description,
    parameters: [],
    responses: {
      [ep.successCodes[0] || 200]: {
        description: 'Successful Response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              example: ep.exampleResponse
            }
          }
        }
      }
    }
  };

  // Add path params
  ep.pathParams.forEach(p => {
    operation.parameters.push({
      name: p.name,
      in: 'path',
      required: true,
      schema: { type: p.type === 'integer' ? 'integer' : 'string' },
      description: p.description
    });
  });

  // Add query params
  ep.queryParams.forEach(q => {
    operation.parameters.push({
      name: q.name,
      in: 'query',
      required: false,
      schema: { type: q.type === 'integer' ? 'integer' : 'string' },
      description: q.description
    });
  });

  // Add security schema if auth required
  if (ep.auth === 'Yes') {
    operation.security = [{ BearerAuth: [] }];
  }

  // Add body
  if (ep.bodySchema) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            example: ep.exampleRequest
          }
        }
      }
    };
  }

  openapi.paths[swaggerPath][methodLower] = operation;
});

// Add security scheme definitions
openapi.components = {
  securitySchemes: {
    BearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT'
    }
  }
};

fs.writeFileSync(
  path.join(ARTIFACT_DIR, 'openapi.json'),
  JSON.stringify(openapi, null, 2)
);

// --- GENERATE MARKDOWN API INVENTORY ---
let md = `# EnthraHub Faculty Analytics System - API Inventory & Code Audit

This document presents a complete and exhaustive API inventory of the backend codebase, generated dynamically after auditing all Express route registrations, controller bindings, and middlewares.

## Summary of Files Generated

- **OpenAPI 3.0 (Swagger) Specification**: [openapi.json](file://${path.join(ARTIFACT_DIR, 'openapi.json')})
- **Postman Collection (Ready to Import)**: [postman_collection.json](file://${path.join(ARTIFACT_DIR, 'postman_collection.json')})

---

## 1. API Summary & Statistics

| Metric | Value |
| :--- | :--- |
| **Total Registered API Endpoints** | **${totalApis}** |
| GET Endpoints | ${getCount} |
| POST Endpoints | ${postCount} |
| PUT/PATCH Endpoints | ${putPatchCount} |
| DELETE Endpoints | ${deleteCount} |

---

## 2. API Diagnostics & Security Audit Warnings

After performing static analysis on route and controller configurations, the following architectural warnings and vulnerabilities have been flagged:

### ⚠️ Critical Security Vulnerabilities: Missing Authentication

A total of **7 route files** containing **50 endpoints** do not apply any authentication middlewares. Anyone on the network can query, modify, or delete sensitive data:

1. **\`routes/analytics.js\` (8 endpoints)**: Publicly exposes student performance rankings, rating histories, and department aggregates.
2. **\`routes/reports.js\` (16 endpoints)**: Publicly exposes college dashboard statistics, attendance logs, student logs, and faculty summaries.
3. **\`routes/contestmaster.js\` (16 endpoints)**: Publicly exposes live stream data, student listings, and the control endpoint (\\\`/api/contestmaster/live/control\\\`) which allows unauthorized clients to start or halt live contest schedulers.
4. **\`routes/contests.js\` (16 endpoints)**: Allows unauthorized users to add, modify, or delete coding contests, join/register, and trigger sync processes.
5. **\`routes/departments.js\` (8 endpoints)**: Exposes creation, updating, and deletion of college departments.
6. **\`routes/notifications.js\` (10 endpoints)**: Allows reading, archives, and modifications of notifications without authentication.
7. **\`routes/contestLeaderboardSync.js\` (10 endpoints)**: Exposes sync controls, cancellations, and history logs publicly.

### ⚠️ Duplicate Route Definitions

- **System Health Endpoint**: Both \\\`GET /api/health/\\\` and \\\`GET /api/health/system\\\` point to \\\`healthController.getSystemHealth\\\` in \\\`routes/health.js\\\`.
- **Platform Health Endpoint**: Both \\\`GET /api/health/platform\\\` and \\\`GET /api/health/platform/:platform\\\` point to \\\`healthController.getPlatformHealth\\\` (differentiated internally).
- **v1 API Alias namespaces**: Every endpoint is registered under both \\\`/api/\\\` and \\\`/api/v1/\\\` namespaces in \\\`server.js\\\`, creating a duplicate set of 45 routes (total 90).

### 📝 Validation & Error Handling Gaps

- **Missing Schema Validation**: Route controllers do not use libraries like \\\`Joi\\\` or \\\`express-validator\\\`. Required body elements are verified with basic \\\`!field\\\` checks.
- **SQL Detail Leaks**: Multiple try-catch blocks return SQL engine syntax errors directly in response JSON (e.g. in \\\`studentController.js\\\`), which reveals table columns and schemas to malicious clients.
- **No Unused Code Detected**: All controller files and exported functions are active. Unused middlewares are not present.

---

## 3. API Inventory Tables by Module

`;

// Append grouped tables
const groupOrder = [
  'Authentication',
  'Faculty',
  'Students',
  'Dashboard',
  'Analytics',
  'Contest Synchronization',
  'Contest History',
  'Leaderboard',
  'Attendance',
  'Reports',
  'Health',
  'Cache',
  'Admin',
  'Other'
];

groupOrder.forEach(modName => {
  const list = grouped[modName] || [];
  md += `### ${modName} Module (${list.length} Endpoints)\n\n`;
  if (list.length === 0) {
    md += `*No endpoints in this module.*\n\n`;
    return;
  }

  md += `| Method | Full Endpoint URL | Route File | Controller Function | Auth | Cache | Job |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  list.forEach(e => {
    md += `| **${e.method}** | \`${e.fullUrl}\` | \`${e.routeFile}.js\` | \`${e.controller}\` | ${e.auth} | ${e.cache} | ${e.job} |\n`;
  });

  md += `\n`;
  
  // Detailed inventory specifications in collapsible details
  md += `#### Detailed Endpoint Specifications\n\n`;
  
  list.forEach(e => {
    md += `<details>
<summary><b>${e.method} ${e.fullUrl}</b> - ${e.description}</summary>

- **Controller Function**: \`${e.controller}\`
- **Route File**: \`routes/${e.routeFile}.js\`
- **Authentication Required**: ${e.auth}
- **Middlewares Applied**: ${e.middlewares.length > 0 ? e.middlewares.join(', ') : 'None'}
- **Required Headers**: ${e.headers.length > 0 ? e.headers.join(', ') : 'None'}
- **Path Parameters**: ${e.pathParams.length > 0 ? JSON.stringify(e.pathParams) : 'None'}
- **Query Parameters**: ${e.queryParams.length > 0 ? JSON.stringify(e.queryParams) : 'None'}
- **Request Body Schema**: ${e.bodySchema ? '\`\`\`json\\n' + JSON.stringify(epSchemaFilter(e.bodySchema), null, 2) + '\\n\`\`\`' : 'None'}
- **Response Schema**: ${e.responseSchema ? '\`\`\`json\\n' + JSON.stringify(epSchemaFilter(e.responseSchema), null, 2) + '\\n\`\`\`' : 'None'}
- **Success Status Codes**: ${e.successCodes.join(', ')}
- **Error Status Codes**: ${e.errorCodes.join(', ')}
- **Validation Rules**: ${e.validation}
- **Database Tables Used**: ${e.tables.join(', ')}
- **External APIs Called**: ${e.externalApis}
- **Cache Used**: ${e.cache}
- **Background Job Triggered**: ${e.job}

##### Example Request
${e.exampleRequest ? '\`\`\`json\\n' + JSON.stringify(e.exampleRequest, null, 2) + '\\n\`\`\`' : '*No request body required.*'}

##### Example Response (Success)
${e.exampleResponse ? '\`\`\`json\\n' + JSON.stringify(e.exampleResponse, null, 2) + '\\n\`\`\`' : '*Empty success response.*'}

</details>
<br/>\n\n`;
  });
});

function epSchemaFilter(val) {
  return val;
}

fs.writeFileSync(path.join(ARTIFACT_DIR, 'api_inventory.md'), md);
console.log('Artifacts generated successfully!');
