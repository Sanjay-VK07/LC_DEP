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
  console.log('--- TESTING LOGIN (cseadmin / cseadmin123) ON PORT 3000 ---');
  const res = await testLogin('cseadmin', 'cseadmin123');
  console.log('StatusCode:', res.statusCode);
  console.log('Response Success:', res.body.success);
  console.log('User:', res.body.user);
  console.log('Has Token:', !!res.body.token);
}

run();
