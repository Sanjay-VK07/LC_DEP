const db = require('../config/db');

async function run() {
  try {
    await db.initializeDatabase();
    console.log('[Constraints] Safely removing restrictive contest slug constraints...');

    try {
      await db.query('ALTER TABLE Contests DROP CONSTRAINT chk_leetcode_slug_format');
      console.log('[Constraints] Dropped chk_leetcode_slug_format constraint from Contests.');
    } catch (e) {
      console.log('[Constraints] No chk_leetcode_slug_format constraint on Contests or already dropped.');
    }

    try {
      await db.query('ALTER TABLE LiveContests DROP CONSTRAINT chk_leetcode_live_slug_format');
      console.log('[Constraints] Dropped chk_leetcode_live_slug_format constraint from LiveContests.');
    } catch (e) {
      console.log('[Constraints] No chk_leetcode_live_slug_format constraint on LiveContests or already dropped.');
    }

    console.log('[Constraints] Contest tables are now open to any valid contest slugs (including numeric IDs and custom contest names).');
    process.exit(0);
  } catch (error) {
    console.error('[Constraints] Failed to update constraints:', error);
    process.exit(1);
  }
}

run();
