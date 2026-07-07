const https = require('https');

/**
 * Helper to perform HTTPS requests
 */
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache'
    };
    
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: { ...defaultHeaders, ...(options.headers || {}) },
      timeout: options.timeout || 12000
    };

    const req = https.request(requestOptions, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers['location'];
        if (redirectUrl) {
          fetchUrl(redirectUrl.startsWith('http') ? redirectUrl : `https://${urlObj.hostname}${redirectUrl}`, options)
            .then(resolve)
            .catch(reject);
          return;
        }
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, data });
      });
    });

    req.on('error', (e) => reject(new Error(`HTTPS fetch failed: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * Parses the CodeChef profile page HTML to extract basic profile stats.
 * @param {string} html - Raw HTML from CodeChef user profile page
 * @returns {object} - Extracted profile details
 */
function parseCodeChefHtml(html) {
  const result = {
    rating: null,
    highestRating: null,
    isProvisional: false,
    globalRank: null,
    stars: null,
    problemsSolved: 0
  };

  // 1. Rating — try multiple patterns (supporting provisional ? and newlines/spaces)
  const ratingMatch = html.match(/class="rating-number"[^>]*>\s*(\d+)(\??)/i) ||
                      html.match(/rating-number[^>]*>\s*(\d+)(\??)/i) ||
                      html.match(/"currentRating"\s*:\s*(\d+)(\??)/i);
  if (ratingMatch) {
    result.rating = parseInt(ratingMatch[1], 10);
    result.isProvisional = ratingMatch[2] === '?';
  }

  // 2. Highest Rating
  const highestMatch = html.match(/Highest Rating\D+(\d+)/i) ||
                       html.match(/\(Highest Rating\s+(\d+)\)/i) ||
                       html.match(/"highestRating"\s*:\s*(\d+)/i);
  if (highestMatch) result.highestRating = parseInt(highestMatch[1], 10);

  // 3. Stars
  const starMatch = html.match(/"stars"\s*:\s*"(\d+)★"/i) ||
                    html.match(/([\d])★/) ||
                    html.match(/class="rating-star"[^>]*>([\d])★/i);
  if (starMatch) result.stars = `${starMatch[1]}★`;

  // 4. Global Rank
  const globalRankMatch = html.match(/href="\/ratings\/all"[^>]*>[\s\S]*?<strong>\s*(\d+)\s*<\/strong>[\s\S]*?Global Rank/i) ||
                          html.match(/strong class=['\"]global-rank['\"][^>]*>(\d+)/i) ||
                          html.match(/class="rating-ranks"[\s\S]*?<strong>(\d+)<\/strong>/i) ||
                          html.match(/"globalRank"\s*:\s*(\d+)/i) ||
                          html.match(/Global Rank\D*(\d+)/i);
  if (globalRankMatch) result.globalRank = parseInt(globalRankMatch[1], 10);

  // 4.5. Country Rank
  const countryRankMatch = html.match(/href="\/ratings\/all\?filterBy=Country[^>]*>[\s\S]*?<strong>\s*(\d+)\s*<\/strong>[\s\S]*?Country Rank/i);
  result.countryRank = countryRankMatch ? parseInt(countryRankMatch[1], 10) : null;

  // 5. Problems Solved
  const solvedCountMatch = html.match(/Total Problems Solved\D*(\d+)/i) ||
                           html.match(/Fully Solved\s*\((\d+)\)/i) ||
                           html.match(/"totalSolved"\s*:\s*(\d+)/i);
  if (solvedCountMatch) result.problemsSolved = parseInt(solvedCountMatch[1], 10);

  return result;
}

/**
 * Parses the CodeChef profile page HTML to extract full contest rating history.
 * CodeChef embeds contest history as JSON inside a <script> tag as part of 
 * the page's initial state — specifically the `all_rating` array.
 *
 * Each entry shape (from CodeChef):
 * { code, name, end_date, rank, rating, diff }
 *
 * @param {string} html - Raw HTML of the CodeChef user profile page
 * @returns {Array} Parsed contest history entries
 */
function parseCodeChefContestHistory(html) {
  const history = [];

  // Strategy 1: Look for the `all_rating` JSON array embedded in <script> tags
  // CodeChef embeds this as: var all_rating = [...];  or  "all_rating":[...]
  const patterns = [
    /var\s+all_rating\s*=\s*(\[[\s\S]*?\])\s*;/i,
    /"all_rating"\s*:\s*(\[[\s\S]*?\])\s*[,}]/i,
    /all_rating\s*:\s*(\[[\s\S]*?\])\s*[,;]/i
  ];

  let rawJson = null;
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m) {
      rawJson = m[1];
      break;
    }
  }

  if (rawJson) {
    try {
      const entries = JSON.parse(rawJson);
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          // CodeChef entry structure: { code, name, end_date, rank, rating, diff }
          const contestName = entry.name || entry.code || 'Unknown Contest';
          const endDate = entry.end_date || entry.date || null;
          const rank = entry.rank ? parseInt(entry.rank, 10) : null;
          const newRating = entry.rating ? parseInt(entry.rating, 10) : null;
          const diff = entry.diff ? parseInt(entry.diff, 10) : 0;
          const oldRating = newRating !== null ? newRating - diff : null;

          if (contestName && newRating !== null) {
            history.push({
              contestName,
              contestDate: endDate,
              rank,
              oldRating,
              newRating,
              ratingChange: diff,
              // Keep raw fields for compatibility
              attended: true,
              rating: newRating,
              ranking: rank,
              contest: { title: contestName, startTime: endDate ? new Date(endDate).getTime() / 1000 : null }
            });
          }
        }
        console.log(`[CodeChef Parser] Extracted ${history.length} contest entries from all_rating JSON.`);
        return history;
      }
    } catch (parseErr) {
      console.warn(`[CodeChef Parser] Failed to parse all_rating JSON: ${parseErr.message}`);
    }
  }

  // Strategy 2: Look for rating data inside a JSON blob anywhere in <script> tags
  const scriptBlocks = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of scriptBlocks) {
    if (!block.includes('rating') || !block.includes('rank')) continue;
    
    // Try to find an array of objects with rating/rank structure
    const arrayMatch = block.match(/\[\s*\{[^[]*?"rank"\s*:\s*\d+[^[]*?"rating"\s*:\s*\d+[\s\S]*?\]/);
    if (arrayMatch) {
      try {
        const entries = JSON.parse(arrayMatch[0]);
        if (Array.isArray(entries) && entries.length > 0 && entries[0].rating) {
          for (const entry of entries) {
            history.push({
              contestName: entry.name || entry.code || entry.contest_name || 'Unknown Contest',
              contestDate: entry.end_date || entry.date || null,
              rank: entry.rank ? parseInt(entry.rank, 10) : null,
              oldRating: entry.rating && entry.diff ? parseInt(entry.rating, 10) - parseInt(entry.diff, 10) : null,
              newRating: entry.rating ? parseInt(entry.rating, 10) : null,
              ratingChange: entry.diff ? parseInt(entry.diff, 10) : 0,
              attended: true,
              rating: entry.rating ? parseInt(entry.rating, 10) : null,
              ranking: entry.rank ? parseInt(entry.rank, 10) : null,
              contest: { title: entry.name || entry.code || 'Unknown', startTime: null }
            });
          }
          if (history.length > 0) {
            console.log(`[CodeChef Parser] Extracted ${history.length} entries via strategy 2.`);
            return history;
          }
        }
      } catch (_) { /* continue to next block */ }
    }
  }

  console.warn('[CodeChef Parser] Could not extract contest history from page HTML.');
  return [];
}

/**
 * Verifies if a CodeChef handle exists and returns basic profile stats.
 * @param {string} username - CodeChef username
 * @returns {Promise<{exists: boolean, username?: string, rating?: number, stars?: string, globalRanking?: number, error?: string}>}
 */
async function verifyCodeChefUsername(username) {
  if (!username || typeof username !== 'string') {
    return { exists: false, error: 'Invalid username' };
  }

  const trimmedUsername = username.trim();
  if (trimmedUsername === '') {
    return { exists: false, error: 'Username cannot be empty' };
  }

  // 1. Try Vercel API first (fast, but may not have history)
  try {
    const response = await fetchUrl(`https://codechef-api.vercel.app/handle/${encodeURIComponent(trimmedUsername)}`, { timeout: 6000 });
    if (response.statusCode === 200) {
      const json = JSON.parse(response.data);
      if (json.rating || json.currentRating) {
        console.log(`[CodeChef Verify] Vercel API succeeded for ${trimmedUsername}`);
        return {
          exists: true,
          username: trimmedUsername,
          rating: json.currentRating ? parseInt(json.currentRating, 10) : (json.rating ? parseInt(json.rating, 10) : null),
          stars: json.stars || null,
          globalRanking: json.globalRank ? parseInt(json.globalRank, 10) : null
        };
      }
    }
  } catch (err) {
    console.warn(`[CodeChef Verify] Vercel API failed for ${trimmedUsername}, falling back to scraping: ${err.message}`);
  }

  // 2. Scraping fallback from codechef.com/users/<username>
  try {
    const response = await fetchUrl(`https://www.codechef.com/users/${encodeURIComponent(trimmedUsername)}`);
    if (response.statusCode === 200) {
      const parsed = parseCodeChefHtml(response.data);
      if (parsed.rating !== null || parsed.globalRank !== null || response.data.includes(trimmedUsername)) {
        return {
          exists: true,
          username: trimmedUsername,
          rating: parsed.rating,
          stars: parsed.stars,
          globalRanking: parsed.globalRank
        };
      }
      return { exists: false, error: 'User profile exists but page format unrecognized' };
    } else if (response.statusCode === 404) {
      return { exists: false, error: 'CodeChef username not found' };
    } else {
      return { exists: false, error: `CodeChef returned HTTP status ${response.statusCode}` };
    }
  } catch (err) {
    return { exists: false, error: `Network error connecting to CodeChef: ${err.message}` };
  }
}

/**
 * Fetches full CodeChef user stats including real contest history.
 * Mirrors the LeetCode pattern: tries a fast API first, falls back to scraping,
 * and always returns a populated contestHistory array.
 *
 * @param {string} username - CodeChef username
 * @returns {Promise<object>} Stats including contestHistory array
 */
async function getUserCodeChefStats(username) {
  if (!username) {
    return { success: false, error: 'Invalid username' };
  }
  const trimmedUsername = username.trim();
  if (!trimmedUsername) {
    return { success: false, error: 'Username cannot be empty' };
  }

  console.log(`[CodeChef Stats] Fetching full profile for: ${trimmedUsername}`);

  // Primary path: scrape the user profile page directly.
  // This is reliable and provides both basic stats AND the embedded contest history JSON.
  try {
    const response = await fetchUrl(
      `https://www.codechef.com/users/${encodeURIComponent(trimmedUsername)}`,
      { timeout: 15000 }
    );

    console.log(`[CodeChef Stats] Profile page status for ${trimmedUsername}: HTTP ${response.statusCode}`);

    if (response.statusCode === 200) {
      const html = response.data;

      // Parse basic profile stats
      const parsed = parseCodeChefHtml(html);

      // Parse full contest history from embedded JSON
      const contestHistory = parseCodeChefContestHistory(html);

      const rating = parsed.rating;
      const highestRating = parsed.highestRating || rating;
      const ratingHistory = contestHistory.map(c => c.newRating || c.rating).filter(r => r !== null && r !== undefined);
      const lowestRating = ratingHistory.length > 0 ? Math.min(...ratingHistory) : rating;

      if (rating !== null || response.data.includes(trimmedUsername)) {
        console.log('[AUDIT][SCRAPER] currentRating =', rating, 'highestRating =', highestRating, 'ratingHistory.length =', ratingHistory.length);
        console.log('[AUDIT LOG][Scraper] currentRating =', rating);
        console.log(`[CodeChef Stats] Successfully fetched stats for ${trimmedUsername}: rating=${rating}, contests=${contestHistory.length}`);
        return {
          success: true,
          username: trimmedUsername,
          rating,
          maxRating: highestRating,
          lowestRating,
          isProvisional: parsed.isProvisional,
          stars: parsed.stars,
          globalRanking: parsed.globalRank,
          countryRank: parsed.countryRank,
          problemsSolved: parsed.problemsSolved || 0,
          contestParticipationCount: contestHistory.length,
          contestHistory,
          ratingHistory
        };
      }

      console.warn(`[CodeChef Stats] Page returned 200 but profile data not found for ${trimmedUsername}`);
      return { success: false, error: 'Failed to parse CodeChef profile data from page' };

    } else if (response.statusCode === 404) {
      return { success: false, error: 'CodeChef username not found' };
    } else {
      return { success: false, error: `CodeChef returned HTTP status ${response.statusCode}` };
    }
  } catch (primaryErr) {
    console.warn(`[CodeChef Stats] Primary scrape failed for ${trimmedUsername}: ${primaryErr.message}. Trying Vercel fallback...`);
  }

  // Fallback: Try Vercel API (no history, but at least gets basic stats)
  try {
    const response = await fetchUrl(
      `https://codechef-api.vercel.app/handle/${encodeURIComponent(trimmedUsername)}`,
      { timeout: 8000 }
    );
    if (response.statusCode === 200) {
      const json = JSON.parse(response.data);
      const rating = json.currentRating ? parseInt(json.currentRating, 10) : (json.rating ? parseInt(json.rating, 10) : null);
      if (rating) {
        const highestRating = json.highestRating ? parseInt(json.highestRating, 10) : rating;
        const ratingHistory = [];
        const lowestRating = rating;
        const currentRatingStr = json.currentRating ? String(json.currentRating) : (json.rating ? String(json.rating) : '');
        const isProvisional = currentRatingStr.includes('?');

        console.log('[AUDIT][SCRAPER] currentRating =', rating, 'highestRating =', highestRating, 'ratingHistory.length =', ratingHistory.length);
        console.log(`[CodeChef Stats] Vercel fallback succeeded for ${trimmedUsername} (no history)`);
        return {
          success: true,
          username: trimmedUsername,
          rating,
          maxRating: highestRating,
          lowestRating,
          isProvisional,
          stars: json.stars || null,
          globalRanking: json.globalRank ? parseInt(json.globalRank, 10) : null,
          problemsSolved: json.problemsSolved ? parseInt(json.problemsSolved, 10) : 0,
          contestParticipationCount: 0,
          contestHistory: [], // Vercel API doesn't provide history
          ratingHistory
        };
      }
    }
  } catch (fallbackErr) {
    console.error(`[CodeChef Stats] Vercel fallback also failed for ${trimmedUsername}: ${fallbackErr.message}`);
  }

  return { success: false, error: `Failed to fetch CodeChef stats for ${trimmedUsername}` };
}

module.exports = {
  verifyCodeChefUsername,
  getUserCodeChefStats,
  parseCodeChefContestHistory
};
