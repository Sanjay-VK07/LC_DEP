const { test } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Shared LeetCode profile URL construction logic.
 * (Identical to frontend/src/utils/platformUrls.js)
 */
function getLeetCodeProfileUrl(username) {
  if (!username || !username.trim()) return null;
  return `https://leetcode.com/u/${encodeURIComponent(username.trim())}/`;
}

test('LeetCode Profile URL Construction - Valid username', () => {
  const result = getLeetCodeProfileUrl('valid_handle');
  assert.equal(result, 'https://leetcode.com/u/valid_handle/');
  assert.equal(result.includes('undefined'), false);
  assert.equal(result.includes('null'), false);
  assert.equal(result.includes('//', 8), false); // check double slash after 'https://'
});

test('LeetCode Profile URL Construction - Username with spaces', () => {
  const result = getLeetCodeProfileUrl('  user name  ');
  assert.equal(result, 'https://leetcode.com/u/user%20name/');
  assert.equal(result.includes('undefined'), false);
  assert.equal(result.includes('null'), false);
  assert.equal(result.includes('//', 8), false);
});

test('LeetCode Profile URL Construction - Username with special characters', () => {
  const result = getLeetCodeProfileUrl('user#name?');
  assert.equal(result, 'https://leetcode.com/u/user%23name%3F/');
  assert.equal(result.includes('undefined'), false);
  assert.equal(result.includes('null'), false);
  assert.equal(result.includes('//', 8), false);
});

test('LeetCode Profile URL Construction - Undefined username', () => {
  const result = getLeetCodeProfileUrl(undefined);
  assert.equal(result, null);
});

test('LeetCode Profile URL Construction - Null username', () => {
  const result = getLeetCodeProfileUrl(null);
  assert.equal(result, null);
});

test('LeetCode Profile URL Construction - Empty string', () => {
  const result = getLeetCodeProfileUrl('');
  assert.equal(result, null);
});

test('LeetCode Profile URL Construction - Whitespace string', () => {
  const result = getLeetCodeProfileUrl('   ');
  assert.equal(result, null);
});

test('LeetCode Profile URL Construction - Missing property (object query)', () => {
  const student = { name: 'Ganesh' }; // leetcode_username property is missing
  const result = getLeetCodeProfileUrl(student.leetcode_username);
  assert.equal(result, null);
});
