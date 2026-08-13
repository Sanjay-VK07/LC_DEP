const db = require('./config/db');
const jwt = require('jsonwebtoken');
const http = require('http');

require('dotenv').config();

async function runLiveServerFailureTest() {
  console.log('[Test Setup] Starting live server failure reproduction...');
  
  // Start server inline or require modules
  await db.initializeDatabase();

  const jobQueue = require('./services/jobQueueService');
  const StudentContestSyncService = require('./services/StudentContestSyncService');
  const LeetCodeAdapter = require('./services/adapters/LeetCodeAdapter');
  const leetcodeUtils = require('./utils/leetcode');
  const DetailedLogger = require('./utils/detailedLogger');

  console.log('[LeetCode Sync Telemetry] Request Started -> Authentication (0 ms)');
  console.log('[LeetCode Sync Telemetry] Enqueuing background sync job for "weekly-contest-483" using provider "HYBRID"...');

  // Override Attempt 1 (Leaderboard API) to fail with Cloudflare 403
  const origFetchFull = LeetCodeAdapter.prototype._fetchFullLeaderboard;
  LeetCodeAdapter.prototype._fetchFullLeaderboard = async function(slug, options) {
    console.log(`[RAW_RANKING] Attempting contest participant retrieval for "${slug}"...`);
    
    DetailedLogger.logRequest({
      url: `https://leetcode.com/contest/api/ranking/${slug}/?pagination=1`,
      contestSlug: slug,
      pageNumber: 1,
      httpStatus: 403,
      statusText: 'Forbidden',
      contentType: 'text/html; charset=UTF-8',
      responseSize: 5240,
      bodyPreview: '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><h1>Attention Required! | Cloudflare</h1><p>Please complete the security check to access leetcode.com</p></body></html>',
      isHtml: true,
      matchedMarker: 'Just a moment...',
      durationMs: 412,
      retryCount: 0,
      errorType: 'CLOUDFLARE_BLOCK',
      message: 'Cloudflare security check blocked leaderboard API access (HTTP 403)'
    });

    const err = new Error('HTTP 403 Forbidden Cloudflare challenge page (cf-mitigated: challenge)');
    err.code = 'CLOUDFLARE_BLOCK';
    err.status = 403;
    err.isCloudflare = true;
    err.retryable = false;
    throw err;
  };

  // Override Attempt 2 (GraphQL) to fail with GraphQL timeout/error
  const origFetchGql = LeetCodeAdapter.prototype._fetchViaGraphQLFallback;
  LeetCodeAdapter.prototype._fetchViaGraphQLFallback = async function(slug, students) {
    console.log(`[GRAPHQL] Attempting contest participant retrieval for "${slug}"...`);
    console.log(`[GRAPHQL_FALLBACK] Initiating batched student participation fallback for contest "${slug}"...`);
    console.log(`[GRAPHQL_BATCH] Processing 987 handles across 40 batches (Batch Size: 25)...`);
    
    for (let b = 1; b <= 3; b++) {
      console.warn(`[GRAPHQL_BATCH] Batch query failed for batch ${b} (25 handles): Network error connecting to LeetCode: LeetCode GraphQL request timed out (HTTP 504 / Connection Timeout)`);
    }
    console.warn(`[GRAPHQL_FALLBACK] Resolved 0 attending participants out of 987 total handles (987 unresolved).`);
    console.warn(`[GRAPHQL_FALLBACK] GraphQL fallback failed for "${slug}": 0 attending participants resolved from 987 student handles.`);
    return { participants: [], resolvedCount: 0, unresolvedCount: 987, unresolvedUsernames: [], isComplete: false };
  };

  // Override Attempt 3 (Alfa API) to fail with rate limit / 429
  const origFetchAlfa = LeetCodeAdapter.prototype._fetchViaAlfaApiFallback;
  LeetCodeAdapter.prototype._fetchViaAlfaApiFallback = async function(slug, handles) {
    console.log(`[ALFA_API] Attempting alfa-leetcode-api fallback for "${slug}"...`);
    console.log(`[ALFA_API_FALLBACK] Querying alfa-leetcode-api for 987 unresolved student handles for contest "${slug}"...`);
    
    console.warn(`[ALFA_API_FALLBACK] Error fetching student_1 from alfa-leetcode-api: Request failed with status code 429 (Too Many Requests / Render Free Tier Rate Limit)`);
    console.warn(`[ALFA_CIRCUIT] OPEN — skipping alfa-leetcode-api for "${slug}".`);
    console.warn(`[ALFA_API_FALLBACK] Resolved 0 attending participants out of 987 handles (987 unresolved).`);
    console.warn(`[ALFA_API_FALLBACK] alfa-leetcode-api fallback failed for "${slug}": 0 attending participants resolved.`);
    return { participants: [], resolvedCount: 0, unresolvedCount: 987, unresolvedUsernames: [] };
  };

  // Enqueue job via JobQueueService
  const jobId = jobQueue.enqueue(
    jobQueue.JOB_TYPE.CONTEST_ATTENDANCE_SYNC,
    { contestSlug: 'weekly-contest-483', providerType: 'HYBRID', actor: 'admin' },
    async (job, updateProgress) => {
      updateProgress(5, `Fetching active student roster for 'weekly-contest-483'...`);
      const result = await StudentContestSyncService.syncContestAttendance({
        contestSlug: 'weekly-contest-483',
        providerType: 'HYBRID',
        actor: 'admin',
        bypassCache: true,
        onProgress: (pct, msg) => updateProgress(pct, msg)
      });
      return result;
    }
  );

  console.log(`[LeetCode Sync Telemetry] Request Started -> Authentication (0 ms) -> Job Enqueued (18 ms) -> Response Sent (18 ms) [jobId="${jobId}", reqId="sync_${Date.now()}"]`);
  console.log(`[HTTP Request] POST /api/attendance/leetcode-sync - Status: 200 - User: admin (Super Admin) - Body: {"contestSlug":"weekly-contest-483"}`);

  // Wait for job execution in background
  await new Promise(r => setTimeout(r, 2500));

  // Restore orig
  LeetCodeAdapter.prototype._fetchFullLeaderboard = origFetchFull;
  LeetCodeAdapter.prototype._fetchViaGraphQLFallback = origFetchGql;
  LeetCodeAdapter.prototype._fetchViaAlfaApiFallback = origFetchAlfa;
}

runLiveServerFailureTest()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
