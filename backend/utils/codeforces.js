const https = require('https');

/**
 * Generic helper to query Codeforces API
 * @param {string} path - API endpoint path
 * @returns {Promise<object>} - Parsed JSON response
 */
function queryCodeforces(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'codeforces.com',
      path: path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000 // 10 seconds timeout
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            if (json.status === 'FAILED') {
              reject(new Error(json.comment || 'Codeforces API failed'));
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error(`Failed to parse Codeforces response: ${e.message}`));
          }
        } else if (res.statusCode === 400) {
          // Typically indicates user not found
          try {
            const json = JSON.parse(data);
            reject(new Error(json.comment || 'Codeforces user not found'));
          } catch (e) {
            reject(new Error(`Codeforces API returned 400 Bad Request`));
          }
        } else {
          reject(new Error(`Codeforces API returned status code ${res.statusCode}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Network error connecting to Codeforces: ${e.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Codeforces request timed out'));
    });

    req.end();
  });
}

/**
 * Verifies if a Codeforces handle exists
 * @param {string} username - Codeforces username/handle
 * @returns {Promise<{exists: boolean, username?: string, rating?: number, maxRating?: number, rank?: string, maxRank?: string, error?: string}>}
 */
async function verifyCodeforcesUsername(username) {
  if (!username || typeof username !== 'string') {
    return { exists: false, error: 'Invalid username' };
  }

  const trimmedUsername = username.trim();
  if (trimmedUsername === '') {
    return { exists: false, error: 'Username cannot be empty' };
  }

  try {
    const json = await queryCodeforces(`/api/user.info?handles=${encodeURIComponent(trimmedUsername)}`);
    if (json.status === 'OK' && json.result && json.result.length > 0) {
      const user = json.result[0];
      return {
        exists: true,
        username: user.handle,
        rating: user.rating || null,
        maxRating: user.maxRating || null,
        rank: user.rank || null,
        maxRank: user.maxRank || null
      };
    }
    return { exists: false };
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('handles:')) {
      return { exists: false, error: 'Codeforces username not found' };
    }
    return { exists: false, error: err.message };
  }
}

/**
 * Fetches Codeforces user statistics (rating, contest participation, problems solved count, contest history)
 * @param {string} username - Codeforces username/handle
 * @returns {Promise<object>}
 */
async function getUserCodeforcesStats(username) {
  if (!username) {
    return { success: false, error: 'Invalid username' };
  }
  const trimmedUsername = username.trim();

  try {
    // 1. Fetch user info
    const infoRes = await queryCodeforces(`/api/user.info?handles=${encodeURIComponent(trimmedUsername)}`);
    if (infoRes.status !== 'OK' || !infoRes.result || infoRes.result.length === 0) {
      return { success: false, error: 'User not found' };
    }
    const info = infoRes.result[0];

    // 2. Fetch rating history
    let contestHistory = [];
    try {
      const ratingRes = await queryCodeforces(`/api/user.rating?handle=${encodeURIComponent(trimmedUsername)}`);
      if (ratingRes.status === 'OK' && ratingRes.result) {
        contestHistory = ratingRes.result;
      }
    } catch (err) {
      console.warn(`[Codeforces] Failed to fetch rating history for ${trimmedUsername}:`, err.message);
    }

    // 3. Fetch status/submissions to count unique solved problems
    let problemsSolved = 0;
    try {
      const statusRes = await queryCodeforces(`/api/user.status?handle=${encodeURIComponent(trimmedUsername)}&from=1&count=2000`);
      if (statusRes.status === 'OK' && statusRes.result) {
        const uniqueSolved = new Set();
        statusRes.result.forEach(sub => {
          if (sub.verdict === 'OK' && sub.problem) {
            const probId = sub.problem.contestId 
              ? `${sub.problem.contestId}-${sub.problem.index}`
              : sub.problem.name;
            uniqueSolved.add(probId);
          }
        });
        problemsSolved = uniqueSolved.size;
      }
    } catch (err) {
      console.warn(`[Codeforces] Failed to fetch submissions for ${trimmedUsername}:`, err.message);
    }

    return {
      success: true,
      username: info.handle,
      rating: info.rating || null,
      maxRating: info.maxRating || null,
      rank: info.rank || null,
      maxRank: info.maxRank || null,
      problemsSolved: problemsSolved,
      contestParticipationCount: contestHistory.length,
      contestHistory: contestHistory
    };
  } catch (err) {
    console.error(`[Codeforces Stats] Error fetching for ${trimmedUsername}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  queryCodeforces,
  verifyCodeforcesUsername,
  getUserCodeforcesStats
};
