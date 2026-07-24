/**
 * Verification API Routes Declaration (Phase 2 Interface)
 */
const express = require('express');
const router = express.Router();
const VerificationController = require('../controllers/verificationController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

const adminFacultyAuth = authorize(['Super Admin', 'HOD', 'Faculty']);

// Route Specifications for Audit & Safe Registration
const routeDefinitions = [
  { method: 'get', path: '/:platform/:username', middlewares: [authenticate], handler: VerificationController.getVerificationStatus, handlerName: 'getVerificationStatus' },
  { method: 'post', path: '/refresh', middlewares: [authenticate, adminFacultyAuth], handler: VerificationController.refreshVerification, handlerName: 'refreshVerification' },
  { method: 'get', path: '/job/:jobId', middlewares: [authenticate], handler: VerificationController.getJobVerificationStatus, handlerName: 'getJobVerificationStatus' }
];

console.log('[Verification Routes Diagnostic]');
let auditFailed = false;

routeDefinitions.forEach(route => {
  const methodUpper = route.method.toUpperCase();
  const routeLabel = `${methodUpper} ${route.path}`;

  // Validate middleware functions
  route.middlewares.forEach((mw, idx) => {
    if (typeof mw !== 'function') {
      console.error(`  ✗ ${routeLabel} -> Middleware #${idx + 1} is UNDEFINED`);
      auditFailed = true;
    }
  });

  // Validate controller handler function
  if (typeof route.handler !== 'function') {
    console.error(`  ✗ ${routeLabel} -> VerificationController.${route.handlerName} is UNDEFINED`);
    auditFailed = true;
  } else {
    console.log(`  ✓ ${routeLabel} -> VerificationController.${route.handlerName}`);
  }
});

if (auditFailed) {
  throw new Error('[Verification Routes Audit Failed] One or more route handlers or middlewares are undefined.');
}

// Safely register routes
routeDefinitions.forEach(route => {
  router[route.method](route.path, ...route.middlewares, route.handler);
});

module.exports = router;

