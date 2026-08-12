const db = require('./config/db');
const { getAdapter } = require('./services/adapters/AdapterFactory');
const adapter = getAdapter('leetcode');

async function testRealSync483() {
  console.log('======================================================================');
  console.log('Testing Real Local Contest Sync for weekly-contest-483');
  console.log('======================================================================\n');

  await db.initializeDatabase();

  try {
    const result = await adapter.getContestParticipants('weekly-contest-483', {
      bypassCache: true,
      students: [
        { leetcode_username: 'tourist' },
        { leetcode_username: 'neal_wu' }
      ]
    });

    console.log('\n----------------------------------------------------------------------');
    console.log('Result Status:', result.syncStatus);
    console.log('Source:', result.source);
    console.log('Participants Count:', result.length || (result.participants ? result.participants.length : 0));
    console.log('----------------------------------------------------------------------');
  } catch (err) {
    console.log('\n----------------------------------------------------------------------');
    console.log('Caught Expected Error State:');
    console.log('Code:', err.code || err.syncStatus);
    console.log('Message:', err.message);
    console.log('----------------------------------------------------------------------');
  }
}

testRealSync483()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Real Sync Test Error:', err);
    process.exit(1);
  });
