function createBasePlatformProfile(platform, username, overrides = {}) {
  return {
    platform,
    username: username || null,
    verified: false,
    status: overrides.status || 'unavailable',
    message: overrides.message || null,
    rating: null,
    maxRating: null,
    problemsSolved: 0,
    contests: 0,
    rank: null,
    badges: [],
    submissions: [],
    lastUpdated: new Date().toISOString(),
    metadata: overrides.metadata || {}
  };
}

function normalizeLeetCodeProfile(result, username) {
  const profile = createBasePlatformProfile('leetcode', username, {
    status: result?.verified ? 'verified' : 'unavailable',
    message: result?.message || null
  });

  if (result?.success || result?.verified) {
    profile.verified = true;
    profile.rating = result.contestRating ?? result.rating ?? null;
    profile.maxRating = result.maxRating ?? result.contestRating ?? result.rating ?? null;
    profile.problemsSolved = result.totalSolved || result.problemsSolved || 0;
    profile.contests = result.contestParticipationCount || 0;
    profile.rank = result.globalRanking || null;
    profile.submissions = result.submissions || [];
    profile.metadata = {
      activeDays: result.activeDays || 0,
      easySolved: result.easySolved || 0,
      mediumSolved: result.mediumSolved || 0,
      hardSolved: result.hardSolved || 0
    };
  }

  return profile;
}

function normalizeCodeChefProfile(result, username) {
  const profile = createBasePlatformProfile('codechef', username, {
    status: result?.verified ? 'verified' : 'unavailable',
    message: result?.message || null
  });

  if (result?.success || result?.verified) {
    profile.verified = true;
    
    let ratingHistory = result.ratingHistory;
    if (!Array.isArray(ratingHistory)) {
      if (Array.isArray(result.contestHistory)) {
        ratingHistory = result.contestHistory.map(c => c.newRating || c.rating).filter(r => r !== null && r !== undefined);
      } else {
        ratingHistory = [];
      }
    }

    let ccRating = result.rating ?? null;
    let ccHighest = result.maxRating ?? result.highestRating ?? ccRating ?? null;
    let ccLowest = result.lowestRating ?? null;
    
    // 1. If scraper fails to provide currentRating: derive Current Rating = latest contest rating
    if (ccRating === null && ratingHistory.length > 0) {
      ccRating = ratingHistory[ratingHistory.length - 1];
    }
    
    // 2. If scraper fails to provide highestRating: derive Highest Rating = MAX(all ratings in ratingHistory)
    if (ccHighest === null && ratingHistory.length > 0) {
      ccHighest = Math.max(...ratingHistory);
    }
    
    // 3. If scraper fails to provide lowestRating: derive Lowest Rating = MIN(all ratings)
    if (ccLowest === null && ratingHistory.length > 0) {
      ccLowest = Math.min(...ratingHistory);
    } else if (ccLowest === null && ccRating !== null) {
      ccLowest = ccRating;
    }
    
    profile.rating = ccRating;
    profile.maxRating = ccHighest;
    profile.lowestRating = ccLowest;

    const isRated = ccRating !== null;
    const isProvisional = result.isProvisional || false;
    let status = 'UNRATED';
    if (isRated) {
      status = isProvisional ? 'PROVISIONAL' : 'RATED';
    }

    profile.isRated = isRated;
    profile.isProvisional = isProvisional;
    profile.status = status;
    profile.currentRating = ccRating;
    profile.highestRating = ccHighest;

    console.log('[AUDIT][NORMALIZATION] currentRating =', ccRating, 'highestRating =', ccHighest, 'lowestRating =', ccLowest, 'ratingHistory.length =', ratingHistory.length);
    console.log('[AUDIT LOG][Normalization] currentRating =', profile.rating);
    
    profile.problemsSolved = result.problemsSolved || 0;
    profile.contests = result.contestParticipationCount || 0;
    profile.rank = result.globalRanking || null;
    profile.countryRank = result.countryRank || null;

    let calculatedStars = result.stars;
    if (!calculatedStars && profile.rating) {
      const r = Number(profile.rating);
      if (r < 1400) calculatedStars = '1★';
      else if (r < 1600) calculatedStars = '2★';
      else if (r < 1800) calculatedStars = '3★';
      else if (r < 2000) calculatedStars = '4★';
      else if (r < 2200) calculatedStars = '5★';
      else if (r < 2500) calculatedStars = '6★';
      else calculatedStars = '7★';
    }
    profile.stars = calculatedStars;
    profile.metadata = {
      stars: calculatedStars || '1★',
      contestHistory: result.contestHistory || [],
      ratingHistory,
      lowestRating: ccLowest
    };
  }

  return profile;
}

function normalizeCodeforcesProfile(result, username) {
  const profile = createBasePlatformProfile('codeforces', username, {
    status: result?.verified ? 'verified' : 'unavailable',
    message: result?.message || null
  });

  if (result?.success || result?.verified) {
    profile.verified = true;
    profile.rating = result.rating ?? null;
    profile.maxRating = result.maxRating ?? result.rating ?? null;
    profile.problemsSolved = result.problemsSolved || 0;
    profile.contests = result.contestParticipationCount || 0;
    profile.rank = result.rank || null;
    profile.metadata = {
      maxRank: result.maxRank || null,
      contestHistory: result.contestHistory || []
    };
  }

  return profile;
}

function normalizeHackerRankProfile(result, username) {
  const profile = createBasePlatformProfile('hackerrank', username, {
    status: result?.verified ? 'verified' : 'unavailable',
    message: result?.message || null
  });

  if (result?.success || result?.verified) {
    profile.verified = true;
    profile.problemsSolved = result.problemsSolved || 0;
    profile.contests = result.contestParticipationCount || 0;
    profile.badges = Array.isArray(result.badges) ? result.badges : [];
    profile.metadata = {
      stars: result.stars || 0,
      certificates: result.certificates || []
    };
  }

  return profile;
}

function normalizeHandle(handle) {
  return (handle || "").trim().toLowerCase();
}

module.exports = {
  createBasePlatformProfile,
  normalizeLeetCodeProfile,
  normalizeCodeChefProfile,
  normalizeCodeforcesProfile,
  normalizeHackerRankProfile,
  normalizeHandle
};

