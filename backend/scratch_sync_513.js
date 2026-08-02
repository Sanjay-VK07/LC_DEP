const db = require('./config/db');
const StudentContestSyncService = require('./services/StudentContestSyncService');

async function main() {
  await db.initializeDatabase();
  console.log('=== Triggering Sync for weekly-contest-513 ===');
  const res = await StudentContestSyncService.syncContestAttendance({ contestSlug: 'weekly-contest-513' });
  console.log('Sync Result:', res);
  process.exit(0);
}

main();
