const http = require('http');

function testLogin(username, password) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ username, password });
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
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
  console.log('--- TESTING CSE LOGIN ON PORT 3000 (VITE PROXY -> BACKEND) ---');
  const res = await testLogin('cse', 'cse1234');
  console.log('Result:', res);
}

run();
