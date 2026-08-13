const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../backend/.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const ClistClient = require('../backend/services/clist/ClistClient');

async function runConnectivityTest() {
  console.log('[CLIST] Starting Manual Connectivity Audit...');

  // 1. Check Configuration
  const isConfigured = ClistClient.isConfigured();
  if (!isConfigured) {
    console.error('[CLIST] Configuration: FAILED (CLIST_API_KEY missing)');
    process.exit(1);
  }
  console.log('[CLIST] Configuration: OK');

  try {
    // 2. Test API Connectivity & Authentication with bypassCache: true
    const response = await ClistClient.getContests({ limit: 1, bypassCache: true });
    
    console.log('[CLIST] Authentication: OK');
    console.log('[CLIST] API connectivity: OK');
    
    if (response && Array.isArray(response.objects)) {
      console.log('[CLIST] Contest fetch: OK');
      console.log(`[CLIST] Retrieved ${response.objects.length} contest(s) successfully.`);
    } else {
      console.log('[CLIST] Contest fetch: WARNING (empty response objects array)');
    }

    console.log('\n[CLIST Audit Result] ALL CHECKS PASSED SUCCESSFULLY.');
    process.exit(0);
  } catch (err) {
    if (err.status === 401 || err.status === 403 || err.code === 'CLIST_AUTH_FAILED') {
      console.error('[CLIST] Authentication: FAILED (HTTP 401/403 Invalid Key or Unauthenticated User)');
    } else {
      console.error('[CLIST] API connectivity: FAILED -', err.message);
    }
    console.log('[CLIST Audit Result] CONNECTIVITY TEST FAILED.');
    process.exit(1);
  }
}

runConnectivityTest();
