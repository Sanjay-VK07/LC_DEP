/**
 * Helper utilities for platform URLs.
 */

export function getLeetCodeProfileUrl(username) {
  if (!username || !username.trim()) return null;
  return `https://leetcode.com/u/${encodeURIComponent(username.trim())}/`;
}
