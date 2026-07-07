const https = require('https');
const fs = require('fs');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache'
    };
    
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: defaultHeaders,
      timeout: 15000
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve(data);
      });
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

async function run() {
  console.log('Fetching raw HTML...');
  const html = await fetchUrl('https://www.codechef.com/users/divyaroopag');
  fs.writeFileSync('scratch/codechef_divyaroopag.html', html);
  console.log('HTML written to scratch/codechef_divyaroopag.html');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
