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

module.exports = { getAdapter };
