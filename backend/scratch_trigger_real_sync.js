const jwt = require('jsonwebtoken');
const http = require('http');

require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_123_attendance_system';
const token = jwt.sign(
  { id: 1, username: 'admin', role: 'Super Admin' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

const postData = JSON.stringify({ contestSlug: 'weekly-contest-483' });

console.log('[Real Live Test] Sending POST /api/attendance/leetcode-sync for weekly-contest-483...');

const req = http.request(
  {
    hostname: 'localhost',
    port: 3001,
    path: '/api/attendance/leetcode-sync',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'Authorization': `Bearer ${token}`
    }
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      console.log(`[HTTP Response] Status: ${res.statusCode}`);
      console.log(`[HTTP Response] Body: ${data}`);
      try {
        const parsed = JSON.parse(data);
        if (parsed.jobId) {
          console.log(`[Job Enqueued] Job ID: ${parsed.jobId}. Polling status every 3s...`);
          pollJob(parsed.jobId);
        }
      } catch (e) {
        console.error('JSON parse error:', e);
      }
    });
  }
);

req.on('error', (err) => {
  console.error('HTTP Request error:', err.message);
});

req.write(postData);
req.end();

function pollJob(jobId) {
  const timer = setInterval(() => {
    http.get(
      {
        hostname: 'localhost',
        port: 3001,
        path: `/api/jobs/${jobId}`,
        headers: { Authorization: `Bearer ${token}` }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            const job = json.data;
            if (job) {
              console.log(`[Job ${jobId}] Status: ${job.status} | Progress: ${job.progress}% | Message: ${job.message}`);
              if (job.status === 'COMPLETED' || job.status === 'FAILED') {
                console.log(`[Job ${jobId}] Final status: ${job.status}. Error: ${job.error || 'None'}`);
                clearInterval(timer);
                process.exit(0);
              }
            }
          } catch (e) {}
        });
      }
    );
  }, 3000);
}
