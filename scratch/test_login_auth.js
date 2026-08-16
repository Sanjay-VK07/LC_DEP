const http = require('http');

function testLogin(username, password) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ username, password });
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data || '{}') }));
    });
    req.on('error', err => resolve({ statusCode: 'ERR', body: err.message }));
    req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('--- TESTING ADMIN LOGIN ---');
  const res1 = await testLogin('admin', 'admin123');
  console.log('admin / admin123:', res1);

  console.log('\n--- TESTING WRONG PASS ---');
  const res2 = await testLogin('admin', 'wrongpass');
  console.log('admin / wrongpass:', res2);
}

run();
