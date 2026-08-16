const http = require('http');

function sendLogin(port, payload) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost',
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
      res.on('end', () => resolve({ port, statusCode: res.statusCode, data: JSON.parse(data || '{}') }));
    });
    req.on('error', err => resolve({ port, statusCode: 'ERR', data: err.message }));
    req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('--- TEST 1: cseadmin / cseadmin123 ---');
  console.log('Direct 3001:', await sendLogin(3001, { username: 'cseadmin', password: 'cseadmin123' }));
  console.log('Vite 3000  :', await sendLogin(3000, { username: 'cseadmin', password: 'cseadmin123' }));

  console.log('\n--- TEST 2: cse / cseadmin123 ---');
  console.log('Direct 3001:', await sendLogin(3001, { username: 'cse', password: 'cseadmin123' }));
  console.log('Vite 3000  :', await sendLogin(3000, { username: 'cse', password: 'cseadmin123' }));

  console.log('\n--- TEST 3: cseadmin / cseadmin123 (with whitespace/casing test) ---');
  console.log('Direct 3001:', await sendLogin(3001, { username: ' cseadmin ', password: 'cseadmin123' }));
  console.log('Vite 3000  :', await sendLogin(3000, { username: ' cseadmin ', password: 'cseadmin123' }));
}

run();
