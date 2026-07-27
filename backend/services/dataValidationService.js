/**
 * DataValidationService
 * =====================
 * Validates incoming data for ratings, dates, usernames, and API payloads.
 */

const PLATFORM_USERNAME_REGEX = {
  leetcode: /^[a-zA-Z0-9_-]{3,25}$/,
  codechef: /^[a-zA-Z0-9_]{3,20}$/,
  codeforces: /^[a-zA-Z0-9_.-]{3,24}$/,
  hackerrank: /^[a-zA-Z0-9_-]{3,30}$/
};

const RATING_BOUNDS = {
  leetcode: { min: 0, max: 5000 },
  codechef: { min: 0, max: 4000 },
  codeforces: { min: 0, max: 4000 },
  hackerrank: { min: 0, max: 100 } // star count
};

/**
 * Validate a platform username.
 * @param {string} platform
 * @param {string} username
 * @returns {{ valid: boolean, error?: string }}
 */
function validateUsername(platform, username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username must be a non-empty string' };
  }
  const trimmed = username.trim();
  if (!trimmed) {
    return { valid: false, error: 'Username cannot be blank' };
  }
  const regex = PLATFORM_USERNAME_REGEX[platform.toLowerCase()];
  if (!regex) {
    return { valid: false, error: `Unknown platform: ${platform}` };
  }
  if (!regex.test(trimmed)) {
    return { valid: false, error: `Invalid ${platform} username format: "${trimmed}"` };
  }
  return { valid: true };
}

/**
 * Validate a rating value for a given platform.
 * @param {string} platform
 * @param {number|null} rating
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRating(platform, rating) {
  if (rating === null || rating === undefined) return { valid: true }; // nulls allowed
  const num = Number(rating);
  if (!Number.isFinite(num)) {
    return { valid: false, error: `Rating must be a finite number, got: ${rating}` };
  }
  const bounds = RATING_BOUNDS[platform?.toLowerCase()];
  if (bounds && (num < bounds.min || num > bounds.max)) {
    return { valid: false, error: `Rating ${num} out of expected bounds [${bounds.min}, ${bounds.max}] for ${platform}` };
  }
  return { valid: true };
}

/**
 * Validate a date string or Date object.
 * @param {string|Date} value
 * @param {string} fieldName
 * @returns {{ valid: boolean, error?: string }}
 */
function validateDate(value, fieldName = 'date') {
  if (!value) return { valid: false, error: `${fieldName} is required` };
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return { valid: false, error: `${fieldName} is not a valid date: "${value}"` };
  }
  return { valid: true };
}

/**
 * Validate a student payload for creation/update.
 * @param {object} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateStudentPayload(payload) {
  const errors = [];
  if (!payload.name || !String(payload.name).trim()) errors.push('name is required');
  if (!payload.roll_no || !String(payload.roll_no).trim()) errors.push('roll_no is required');
  if (!payload.department || !String(payload.department).trim()) errors.push('department is required');
  if (!payload.section || !String(payload.section).trim()) errors.push('section is required');
  if (!payload.academic_start_date) errors.push('academic_start_date is required');
  else if (!validateDate(payload.academic_start_date, 'academic_start_date').valid) errors.push('academic_start_date is invalid');
  if (!payload.academic_end_date) errors.push('academic_end_date is required');
  else if (!validateDate(payload.academic_end_date, 'academic_end_date').valid) errors.push('academic_end_date is invalid');

  // Validate platform usernames if provided
  for (const platform of ['leetcode', 'codechef', 'codeforces', 'hackerrank']) {
    const col = `${platform}_username`;
    if (payload[col]) {
      const r = validateUsername(platform, payload[col]);
      if (!r.valid) errors.push(r.error);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a contest history item (from any platform).
 * @param {object} item
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateContestHistoryItem(item) {
  const errors = [];
  if (!item.contestName && !item.contest?.title) errors.push('contestName or contest.title is required');
  if (item.newRating !== null && item.newRating !== undefined && !Number.isFinite(Number(item.newRating))) {
    errors.push('newRating must be a finite number or null');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Sanitize a rating value — convert to integer or return null.
 */
function sanitizeRating(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/**
 * Log a rejected record to the database validation log.
 */
async function logValidationFailure(platform, type, id, data, reason) {
  const db = require('../config/db');
  const auditLog = require('./auditLogService');
  
  const serializedData = data ? (typeof data === 'string' ? data : JSON.stringify(data)) : null;
  console.warn(`[Validation Failure] Platform: ${platform} | Type: ${type} | ID: ${id} | Reason: ${reason}`);

  try {
    await db.query(
      `INSERT INTO ValidationLogs (platform, record_type, record_id, invalid_data, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [platform, type, id ? String(id) : null, serializedData, reason]
    );

    await auditLog.log('VALIDATION_FAILED', {
      severity: 'WARNING',
      targetType: type,
      targetId: id,
      details: { platform, reason, preview: serializedData ? serializedData.substring(0, 200) : '' }
    });
  } catch (err) {
    console.error('[ValidationService] Failed to write validation log to DB:', err.message);
  }
}

/**
 * Validates synchronized platform data.
 * Checks for negative ratings, invalid usernames, duplicate contests, dates and payload corruption.
 */
async function validateSyncData(platform, rawData, username) {
  // 1. Verify username validity
  const userValid = validateUsername(platform, username);
  if (!userValid.valid) {
    await logValidationFailure(platform, 'username', username, null, userValid.error);
    return { valid: false, error: userValid.error };
  }

  // 2. Verify payload structure
  if (!rawData || typeof rawData !== 'object') {
    const err = 'Corrupted platform payload: data is null or not an object';
    await logValidationFailure(platform, 'payload', username, rawData, err);
    return { valid: false, error: err };
  }

  // 3. Verify rating bounds
  if (rawData.rating !== undefined && rawData.rating !== null) {
    const ratingVal = Number(rawData.rating);
    if (ratingVal < 0) {
      const err = `Negative rating detected: ${ratingVal}`;
      await logValidationFailure(platform, 'profile_rating', username, rawData, err);
      return { valid: false, error: err };
    }
    const rateValid = validateRating(platform, rawData.rating);
    if (!rateValid.valid) {
      await logValidationFailure(platform, 'profile_rating_bounds', username, rawData, rateValid.error);
      return { valid: false, error: rateValid.error };
    }
  }

  // 4. Verify contest history items
  if (Array.isArray(rawData.contestHistory)) {
    const seenContests = new Set();
    for (const item of rawData.contestHistory) {
      const name = item.contestName || item.contest?.title || 'Unknown';
      
      // Duplicate check
      if (seenContests.has(name)) {
        const err = `Duplicate contest entry in history: "${name}"`;
        await logValidationFailure(platform, 'contest_history_duplicate', username, item, err);
      }
      seenContests.add(name);

      // Negative rating check in history
      const histRating = item.rating || item.newRating;
      if (histRating !== undefined && histRating !== null && Number(histRating) < 0) {
        const err = `Negative rating in contest history: ${histRating} for contest "${name}"`;
        await logValidationFailure(platform, 'contest_history_rating', username, item, err);
        return { valid: false, error: err };
      }

      // Date check
      const dateVal = item.contestDate || (item.contest?.startTime ? new Date(item.contest.startTime * 1000) : null);
      if (dateVal) {
        const dateValid = validateDate(dateVal, 'contestDate');
        if (!dateValid.valid) {
          const err = `Invalid contest date: "${dateVal}" in contest "${name}"`;
          await logValidationFailure(platform, 'contest_history_date', username, item, err);
          return { valid: false, error: err };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Evaluates the completeness of synchronized platform profile data.
 * Returns percentage (0-100), boolean indicating if complete, and list of missing fields.
 */
function evaluateCompleteness(platform, rawData) {
  const missing = [];
  let score = 100;
  
  if (!rawData || typeof rawData !== 'object') {
    return { complete: false, score: 0, missing: ['profile_data'] };
  }

  const p = platform.toLowerCase();

  if (p === 'leetcode') {
    const totalSolved = Number(rawData.totalSolved || rawData.problemsSolved || 0);
    const hasHistory = Array.isArray(rawData.contestHistory) && rawData.contestHistory.length > 0;
    
    if (totalSolved <= 0) { missing.push('problems_solved'); score -= 20; }
    if (rawData.easySolved === undefined && (rawData.metadata?.easySolved === undefined)) { missing.push('easy_solved'); score -= 15; }
    if (rawData.mediumSolved === undefined && (rawData.metadata?.mediumSolved === undefined)) { missing.push('medium_solved'); score -= 15; }
    if (rawData.hardSolved === undefined && (rawData.metadata?.hardSolved === undefined)) { missing.push('hard_solved'); score -= 15; }
    if (!Array.isArray(rawData.topicStats) || rawData.topicStats.length === 0) { missing.push('topic_stats'); score -= 20; }
    if (!hasHistory) { missing.push('contest_history'); score -= 15; }
  } else if (p === 'codeforces') {
    const totalSolved = Number(rawData.problemsSolved || 0);
    const hasHistory = Array.isArray(rawData.contestHistory) && rawData.contestHistory.length > 0;

    if (totalSolved <= 0) { missing.push('problems_solved'); score -= 30; }
    if (rawData.rating === undefined || rawData.rating === null) { missing.push('rating'); score -= 25; }
    if (rawData.maxRating === undefined || rawData.maxRating === null) { missing.push('max_rating'); score -= 20; }
    if (rawData.rank === undefined || rawData.rank === null) { missing.push('rank'); score -= 10; }
    if (!hasHistory) { missing.push('contest_history'); score -= 15; }
  } else if (p === 'codechef') {
    const totalSolved = Number(rawData.problemsSolved || 0);
    const hasHistory = Array.isArray(rawData.contestHistory) && rawData.contestHistory.length > 0;
    const isUnrated = rawData.unrated || rawData.contestParticipationCount === 0 || (!hasHistory && rawData.rating === null);

    if (totalSolved <= 0) { missing.push('problems_solved'); score -= 30; }
    if (!isUnrated) {
      if (rawData.rating === undefined || rawData.rating === null) { missing.push('rating'); score -= 30; }
      if (rawData.stars === undefined || rawData.stars === null) { missing.push('stars'); score -= 25; }
      if (!hasHistory) { missing.push('contest_history'); score -= 15; }
    }
  } else if (p === 'hackerrank') {
    const totalSolved = Number(rawData.problemsSolved || 0);
    const badges = Array.isArray(rawData.badges) ? rawData.badges : [];

    if (totalSolved <= 0) { missing.push('problems_solved'); score -= 50; }
    if (badges.length === 0) { missing.push('badges'); score -= 50; }
  }

  score = Math.max(0, Math.min(100, score));
  return {
    complete: missing.length === 0,
    score,
    missing
  };
}

module.exports = {
  validateUsername,
  validateRating,
  validateDate,
  validateStudentPayload,
  validateContestHistoryItem,
  sanitizeRating,
  logValidationFailure,
  validateSyncData,
  evaluateCompleteness,
  PLATFORM_USERNAME_REGEX,
  RATING_BOUNDS
};
