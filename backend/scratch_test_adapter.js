const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const LeetCodeAdapter = require('./services/adapters/LeetCodeAdapter');

async function testAdapter() {
  console.log('[TEST ADAPTER] Starting getContestParticipants("weekly-contest-483")...');
  const adapter = new LeetCodeAdapter();
  const startTime = Date.now();

  try {
    const participants = await adapter.getContestParticipants('weekly-contest-483', { bypassCache: true });
    const elapsed = Date.now() - startTime;
    console.log(`[TEST ADAPTER] SUCCESS in ${elapsed}ms! Participants count: ${participants.length}`);
    console.log(`[TEST ADAPTER] Source: ${participants.source}`);
    if (participants.length > 0) {
      console.log('[TEST ADAPTER] Sample participant:', participants[0]);
    }
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[TEST ADAPTER] FAILED in ${elapsed}ms:`, err.message);
    console.error(`[TEST ADAPTER] Code:`, err.code);
    console.error(`[TEST ADAPTER] SyncStatus:`, err.syncStatus);
  }
}

testAdapter();
