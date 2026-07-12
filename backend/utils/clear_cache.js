const cache = require('../services/analyticsCacheService');
const fs = require('fs');
const path = require('path');

function clearCaches() {
  console.log('[Cache Clean] Starting EnthraHub cache cleansing...');

  // 1. Invalidate backend memory cache
  cache.invalidateAll();

  // 2. Clear LeetCode disk caches
  const cacheDir = path.resolve(__dirname, '../cache/leetcode');
  if (fs.existsSync(cacheDir)) {
    try {
      const files = fs.readdirSync(cacheDir);
      let fileCount = 0;
      let dirCount = 0;
      for (const file of files) {
        const fullPath = path.join(cacheDir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          const subFiles = fs.readdirSync(fullPath);
          for (const sf of subFiles) {
            fs.unlinkSync(path.join(fullPath, sf));
          }
          fs.rmdirSync(fullPath);
          dirCount++;
        } else {
          // Keep base contests_cache.json if needed, or delete everything to be completely fresh.
          // Since we want to clear everything, let's delete it.
          fs.unlinkSync(fullPath);
          fileCount++;
        }
      }
      console.log(`[Cache Clean] Deleted ${fileCount} files and ${dirCount} subdirectories in LeetCode cache directory.`);
    } catch (e) {
      console.warn(`[Cache Clean] Error cleaning LeetCode disk cache: ${e.message}`);
    }
  }

  console.log('[Cache Clean] Cache cleansing complete.');
}

if (require.main === module) {
  clearCaches();
}

module.exports = { clearCaches };
