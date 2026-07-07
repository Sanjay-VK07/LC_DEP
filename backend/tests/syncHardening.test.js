const test = require('node:test');
const assert = require('node:assert');

// 1. Test Format Validations
test('Username regex format checks', (t) => {
  const leetcodeRegex = /^[a-zA-Z0-9_-]{3,30}$/;
  const codeforcesRegex = /^[a-zA-Z0-9_-]{3,24}$/;
  const codechefRegex = /^[a-zA-Z0-9_]{3,30}$/;
  const hackerrankRegex = /^[a-zA-Z0-9_.-]{3,30}$/;

  // LeetCode tests
  assert.ok(leetcodeRegex.test('valid_user'));
  assert.ok(leetcodeRegex.test('valid-user-123'));
  assert.ok(!leetcodeRegex.test('in')); // too short
  assert.ok(!leetcodeRegex.test('invalid user space')); // contains space

  // Codeforces tests
  assert.ok(codeforcesRegex.test('tourist'));
  assert.ok(codeforcesRegex.test('code_forces-1'));
  assert.ok(!codeforcesRegex.test('a'.repeat(25))); // too long

  // CodeChef tests
  assert.ok(codechefRegex.test('chef_123'));
  assert.ok(!codechefRegex.test('ch')); // too short

  // HackerRank tests
  assert.ok(hackerrankRegex.test('hr.name-123'));
  assert.ok(!hackerrankRegex.test('hr')); // too short
});

// 2. Test Completeness Scoring logic
test('Data completeness scoring', (t) => {
  const { evaluateCompleteness } = require('../services/dataValidationService');

  // LeetCode complete profile
  const lcComplete = {
    totalSolved: 100,
    easySolved: 40,
    mediumSolved: 40,
    hardSolved: 20,
    topicStats: [{ tagName: 'Array', problemsSolved: 10 }],
    contestHistory: [{ contestName: 'Weekly 1', rating: 1600 }]
  };
  const resLC = evaluateCompleteness('leetcode', lcComplete);
  assert.ok(resLC.complete);
  assert.strictEqual(resLC.score, 100);

  // LeetCode partial profile (missing hardSolved, topicStats, contestHistory)
  const lcPartial = {
    totalSolved: 50,
    easySolved: 30,
    mediumSolved: 20
  };
  const resLCPartial = evaluateCompleteness('leetcode', lcPartial);
  assert.ok(!resLCPartial.complete);
  assert.ok(resLCPartial.score < 100);
  assert.ok(resLCPartial.missing.includes('hard_solved'));
  assert.ok(resLCPartial.missing.includes('topic_stats'));
  assert.ok(resLCPartial.missing.includes('contest_history'));
});

// 3. Test Exponential Backoff Calculation
test('Exponential backoff math', (t) => {
  const calculateDelay = (retryCount) => {
    const delayMin = Math.pow(2, retryCount) * 5;
    return delayMin * 60 * 1000;
  };

  assert.strictEqual(calculateDelay(1), 10 * 60 * 1000); // 10 minutes
  assert.strictEqual(calculateDelay(2), 20 * 60 * 1000); // 20 minutes
  assert.strictEqual(calculateDelay(3), 40 * 60 * 1000); // 40 minutes
  assert.strictEqual(calculateDelay(4), 80 * 60 * 1000); // 80 minutes
  assert.strictEqual(calculateDelay(5), 160 * 60 * 1000); // 160 minutes
});
