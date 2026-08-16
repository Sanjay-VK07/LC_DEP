const http = require('http');

function fetchPath(p) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000${p}`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', err => reject(err));
  });
}

async function runCheck() {
  // Check index.html imports
  const index = await fetchPath('/');
  const scriptMatches = index.body.match(/src="([^"]+)"/g) || [];
  console.log('Script tags in index.html:', scriptMatches);

  // Check main.jsx imports
  const main = await fetchPath('/src/main.jsx');
  const importMatches = main.body.match(/import [^;]+;/g) || [];
  console.log('Imports in main.jsx (first 5):', importMatches.slice(0, 5));

  // Check index.css
  const css = await fetchPath('/src/index.css');
  console.log('index.css status:', css.status, 'bytes:', css.body.length);
}

runCheck().catch(console.error);
