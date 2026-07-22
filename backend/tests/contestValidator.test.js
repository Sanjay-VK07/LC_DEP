const { test } = require('node:test');
const assert = require('node:assert/strict');
const { 
  isOfficialContest, 
  extractContestNumber, 
  getContestType,
  setLatestWeekly,
  setLatestBiweekly,
  setUpperBoundsEnabled
} = require('../utils/contestValidator');

test('Contest Validator - Accept Official formats', () => {
  // Setup fixed bounds for tests
  setLatestWeekly(518);
  setLatestBiweekly(180);

  // Accepted cases
  assert.ok(isOfficialContest('weekly-contest-456'));
  assert.ok(isOfficialContest('weekly-contest-520')); // 520 <= 515 + 3 (weekly limit + tolerance)
  assert.ok(isOfficialContest('biweekly-contest-170'));
  
  // Object format
  assert.ok(isOfficialContest({ slug: 'weekly-contest-456', title: 'Weekly Contest 456' }));
  assert.ok(isOfficialContest({ contestSlug: 'biweekly-contest-170' }));
});

test('Contest Validator - Reject Invalid Slug Formats', () => {
  assert.equal(isOfficialContest('weekly-contest-abc'), false);
  assert.equal(isOfficialContest('weekly-contest-test'), false);
  assert.equal(isOfficialContest('weeklycontest123'), false);
  assert.equal(isOfficialContest('contest-10'), false);
  assert.equal(isOfficialContest('random-contest'), false);
  assert.equal(isOfficialContest('weekly-contest-123-test'), false);
});

test('Contest Validator - Reject Empty Slugs', () => {
  assert.equal(isOfficialContest(''), false);
  assert.equal(isOfficialContest(null), false);
  assert.equal(isOfficialContest(undefined), false);
  assert.equal(isOfficialContest({}), false);
});

test('Contest Validator - Reject Non-Positive and Invalid Contest Numbers', () => {
  assert.equal(isOfficialContest('weekly-contest-0'), false);
  assert.equal(isOfficialContest('weekly-contest--5'), false);
  assert.equal(isOfficialContest('biweekly-contest--170'), false);
});

test('Contest Validator - Reject 999 Fake Contests', () => {
  assert.equal(isOfficialContest('weekly-contest-999'), false);
  assert.equal(isOfficialContest('biweekly-contest-999'), false);
  assert.equal(isOfficialContest({ slug: 'weekly-contest-456', title: 'Fake Contest 999' }), false);
  assert.equal(isOfficialContest({ slug: 'weekly-contest-456', title: 'Placeholder Contest' }), false);
});

test('Contest Validator - Upper bounds checking and tolerance', () => {
  setLatestWeekly(515);
  setLatestBiweekly(180);
  setUpperBoundsEnabled(true);

  // Weekly within tolerance (<= 515 + 3 = 518)
  assert.ok(isOfficialContest('weekly-contest-518'));
  // Weekly beyond tolerance (> 518)
  assert.equal(isOfficialContest('weekly-contest-519'), false);

  // Biweekly within tolerance (<= 180 + 3 = 183)
  assert.ok(isOfficialContest('biweekly-contest-183'));
  // Biweekly beyond tolerance (> 183)
  assert.equal(isOfficialContest('biweekly-contest-184'), false);
});

test('Contest Validator - Disabled upper bounds checks', () => {
  setUpperBoundsEnabled(false);

  // Now weekly-contest-600 should be accepted because bounds are disabled
  assert.ok(isOfficialContest('weekly-contest-600'));
  assert.ok(isOfficialContest('biweekly-contest-300'));

  // Still rejects 999 even when bounds are disabled
  assert.equal(isOfficialContest('weekly-contest-999'), false);
});

test('Contest Validator - Helper extraction utilities', () => {
  assert.equal(extractContestNumber('weekly-contest-456'), 456);
  assert.equal(extractContestNumber('biweekly-contest-170'), 170);
  assert.equal(extractContestNumber('random-slug'), null);

  assert.equal(getContestType('weekly-contest-456'), 'Weekly');
  assert.equal(getContestType('biweekly-contest-170'), 'Biweekly');
  assert.equal(getContestType('random-slug'), null);
});
