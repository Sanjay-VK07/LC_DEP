const db = require('./config/db');
const LeetCodeAdapter = require('./services/adapters/LeetCodeAdapter');
const NetworkService = require('./utils/networkService');

async function runSingleScrape(runNumber) {
  console.log(`\n=== RUN ${runNumber}/3: SCRAPING weekly-contest-514 (CONCURRENCY=5) ===`);

  process.env.LEETCODE_PAGE_CONCURRENCY = '5';
  process.env.LEETCODE_PAGE_DELAY_MS = '50';
  process.env.LEETCODE_MAX_PAGES_LIMIT = '20'; // Fixed 20 pages per run

  let networkRequestCount = 0;
  const originalRequest = NetworkService.request;
  NetworkService.request = async function(...args) {
    networkRequestCount++;
    return originalRequest.apply(this, args);
  };

  const adapter = new LeetCodeAdapter();
  const startTime = Date.now();
  let result;
  try {
    result = await adapter.getContestParticipants('weekly-contest-514', { bypassCache: true });
  } finally {
    NetworkService.request = originalRequest;
  }

  const durationMs = Date.now() - startTime;
  const downloadedParticipants = result.length;
  const pagesFetched = result.pagesFetched;
  const apiRequests = networkRequestCount;

  console.log(`Run ${runNumber} Complete in ${durationMs}ms:`);
  console.log(`  downloadedParticipants: ${downloadedParticipants}`);
  console.log(`  pagesFetched:           ${pagesFetched}`);
  console.log(`  apiRequests:            ${apiRequests}`);

  return {
    run: runNumber,
    downloadedParticipants,
    pagesFetched,
    apiRequests,
    durationMs
  };
}

async function main() {
  try {
    await db.initializeDatabase();

    const runs = [];
    for (let i = 1; i <= 3; i++) {
      const res = await runSingleScrape(i);
      runs.push(res);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n========================================================================');
    console.log('=== SCRAPER DETERMINISM TABLE: 3 CONSECUTIVE RUNS (CONCURRENCY=5) ===');
    console.log('========================================================================\n');

    console.table(runs.map(r => ({
      'Run': `Run ${r.run}`,
      'Downloaded Participants': r.downloadedParticipants,
      'Pages Fetched': r.pagesFetched,
      'API Requests': r.apiRequests,
      'Duration (ms)': r.durationMs
    })));

    const first = runs[0];
    const isDeterministic = runs.every(r => 
      r.downloadedParticipants === first.downloadedParticipants &&
      r.pagesFetched === first.pagesFetched &&
      r.apiRequests === first.apiRequests
    );

    if (isDeterministic) {
      console.log('\n✓ PURE SCRAPER VERIFICATION SUCCESSFUL: All 3 consecutive runs returned 100% IDENTICAL results!\n');
      process.exit(0);
    } else {
      console.error('\n❌ VERIFICATION FAILED: Scraper metrics differ across runs.\n');
      process.exit(1);
    }
  } catch (err) {
    console.error('Determinism Test Error:', err);
    process.exit(1);
  }
}

main();
