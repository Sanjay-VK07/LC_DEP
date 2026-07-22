const db = require('../config/db');

async function run() {
  try {
    await db.initializeDatabase();
    console.log('[Constraints] Adding database constraints for LeetCode contest slugs...');

    // Drop old constraint if exists (safe retry)
    try {
      await db.query('ALTER TABLE Contests DROP CONSTRAINT chk_leetcode_slug_format');
      console.log('[Constraints] Dropped existing chk_leetcode_slug_format constraint.');
    } catch (e) {}

    try {
      await db.query('ALTER TABLE LiveContests DROP CONSTRAINT chk_leetcode_live_slug_format');
      console.log('[Constraints] Dropped existing chk_leetcode_live_slug_format constraint.');
    } catch (e) {}

    // 1. Alter Contests table
    try {
      await db.query(`
        ALTER TABLE Contests 
        ADD CONSTRAINT chk_leetcode_slug_format 
        CHECK (
          platform != 'LeetCode' 
          OR slug REGEXP '^weekly-contest-[0-9]+$' 
          OR slug REGEXP '^biweekly-contest-[0-9]+$'
          OR slug REGEXP '^leetcode-weekly-contest-[0-9]+$'
          OR slug REGEXP '^leetcode-weekly-contest-[0-9]+[a-b]$'
          OR slug = 'weekly-contest-by-app-academy'
          OR slug REGEXP '^(test|mock|dummy|upcoming-live)-'
        )
      `);
      console.log('[Constraints] Added chk_leetcode_slug_format check constraint to Contests table.');
    } catch (err) {
      console.warn('[Constraints] Failed to add constraint to Contests table:', err.message);
    }

    // 2. Alter LiveContests table
    try {
      await db.query(`
        ALTER TABLE LiveContests 
        ADD CONSTRAINT chk_leetcode_live_slug_format 
        CHECK (
          platform != 'LeetCode' 
          OR contestSlug REGEXP '^weekly-contest-[0-9]+$' 
          OR contestSlug REGEXP '^biweekly-contest-[0-9]+$'
          OR contestSlug REGEXP '^leetcode-weekly-contest-[0-9]+$'
          OR contestSlug REGEXP '^leetcode-weekly-contest-[0-9]+[a-b]$'
          OR contestSlug = 'weekly-contest-by-app-academy'
          OR contestSlug REGEXP '^(test|mock|dummy|upcoming-live)-'
        )
      `);
      console.log('[Constraints] Added chk_leetcode_live_slug_format check constraint to LiveContests table.');
    } catch (err) {
      console.warn('[Constraints] Failed to add constraint to LiveContests table:', err.message);
    }

    console.log('[Constraints] Constraint addition completed.');
    process.exit(0);
  } catch (error) {
    console.error('[Constraints] Failed to add constraints:', error);
    process.exit(1);
  }
}

run();
