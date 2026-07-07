/**
 * usernameNormalizer.js
 * =====================
 * Single source of truth for username normalization across the entire codebase.
 * Ensures consistent, case-insensitive matching between LeetCode API responses,
 * database records, and student handles.
 */

// Zero-width and invisible Unicode characters to strip
const INVISIBLE_CHARS_REGEX = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u2000-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F]/g;

/**
 * Normalize a username for consistent matching.
 * - Trims leading/trailing whitespace
 * - Converts to lowercase
 * - Strips zero-width and invisible Unicode characters
 *
 * @param {string|null|undefined} username - Raw username input
 * @returns {string} Normalized username, or empty string if input is falsy
 */
function normalizeUsername(username) {
  if (!username || typeof username !== 'string') {
    return '';
  }
  return username
    .trim()
    .toLowerCase()
    .replace(INVISIBLE_CHARS_REGEX, '');
}

/**
 * Check if two usernames match after normalization.
 *
 * @param {string} a - First username
 * @param {string} b - Second username
 * @returns {boolean} True if normalized forms are equal and non-empty
 */
function usernamesMatch(a, b) {
  const normA = normalizeUsername(a);
  const normB = normalizeUsername(b);
  return normA !== '' && normB !== '' && normA === normB;
}

module.exports = {
  normalizeUsername,
  usernamesMatch
};
