const http = require('http');

function getUrl(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    }).on('error', err => reject(err));
  });
}

async function testVite() {
  try {
    console.log('--- FETCHING http://localhost:3000/ ---');
    const indexRes = await getUrl('http://localhost:3000/');
    console.log('Status Code:', indexRes.statusCode);
    console.log('Content-Type:', indexRes.headers['content-type']);
    console.log('Index HTML Body Snippet:\n', indexRes.body.substring(0, 500));

    console.log('\n--- FETCHING http://localhost:3000/src/main.jsx ---');
    const mainRes = await getUrl('http://localhost:3000/src/main.jsx');
    console.log('Status Code:', mainRes.statusCode);
    console.log('Content-Type:', mainRes.headers['content-type']);
    console.log('main.jsx Body Snippet:\n', mainRes.body.substring(0, 500));

    console.log('\n--- FETCHING http://localhost:3000/src/App.jsx ---');
    const appRes = await getUrl('http://localhost:3000/src/App.jsx');
    console.log('Status Code:', appRes.statusCode);
    console.log('Content-Type:', appRes.headers['content-type']);
    console.log('App.jsx Body Snippet:\n', appRes.body.substring(0, 500));

  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

testVite();
