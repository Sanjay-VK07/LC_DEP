const http = require('http');

function testEndpoint(path) {
  return new Promise((resolve) => {
    http.get(`http://localhost:3001${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ path, statusCode: res.statusCode, body: data }));
    }).on('error', err => resolve({ path, statusCode: 'CONN_ERR', body: err.message }));
  });
}

async function runTests() {
  const paths = [
    '/api/auth/me',
    '/api/auth/login',
    '/api/analytics/dashboard-stats',
    '/api/students?status=active',
    '/api/contests',
    '/api/contest-activity',
    '/api/notifications',
    '/api/departments',
    '/api/health'
  ];

  console.log('=== TESTING BACKEND ROUTES ON PORT 3001 ===\n');
  for (const p of paths) {
    const res = await testEndpoint(p);
    console.log(`Path: ${res.path.padEnd(35)} -> Status: ${res.statusCode}`);
    if (res.statusCode === 404) {
      console.log(`   --> 404 RESPONSE: ${res.body}`);
    }
  }
}

runTests();
