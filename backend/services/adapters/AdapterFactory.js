const LeetCodeAdapter = require('./LeetCodeAdapter');
const CodeforcesAdapter = require('./CodeforcesAdapter');
const CodeChefAdapter = require('./CodeChefAdapter');
const HackerRankAdapter = require('./HackerRankAdapter');

const adapters = {
  leetcode: new LeetCodeAdapter(),
  codeforces: new CodeforcesAdapter(),
  codechef: new CodeChefAdapter(),
  hackerrank: new HackerRankAdapter()
};

function getAdapter(platform) {
  if (!platform) {
    throw new Error('Platform parameter is required');
  }
  const p = platform.toLowerCase().trim();
  const adapter = adapters[p];
  if (!adapter) {
    throw new Error(`Platform adapter not found for platform: ${platform}`);
  }
  return adapter;
}

function setAdapter(platform, adapterInstance) {
  if (!platform) return;
  const p = platform.toLowerCase().trim();
  adapters[p] = adapterInstance;
}

function resetAdapters() {
  adapters.leetcode = new LeetCodeAdapter();
  adapters.codeforces = new CodeforcesAdapter();
  adapters.codechef = new CodeChefAdapter();
  adapters.hackerrank = new HackerRankAdapter();
}

module.exports = {
  getAdapter,
  setAdapter,
  resetAdapters
};

