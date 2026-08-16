const http = require('http');

function postLogin(host, port) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ username: 'admin', password: 'wrongpassword' });
    const req = http.request({
      hostname: host,
      port: port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ port, statusCode: res.statusCode, body: data }));
    });
    req.on('error', err => resolve({ port, statusCode: 'ERR', body: err.message }));
    req.write(postData);
    req.end();
  });
}

async function runTest() {
  console.log('--- TESTING POST /api/auth/login ON PORT 3001 ---');
  const res3001 = await postLogin('localhost', 3001);
  console.log('Port 3001 Result:', res3001);

  console.log('\n--- TESTING POST /api/auth/login ON PORT 3000 ---');
  const res3000 = await postLogin('localhost', 3000);
  console.log('Port 3000 Result:', res3000);
}

runTest();
