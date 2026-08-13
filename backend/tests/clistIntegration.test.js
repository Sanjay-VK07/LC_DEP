const ClistClient = require('../services/clist/ClistClient');
const ClistAdapterClass = require('../services/clist/ClistAdapter');
const AttendanceProviderFactory = require('../services/providers/AttendanceProviderFactory');
const { getAdapter } = require('../services/adapters/AdapterFactory');
const registry = require('../services/PlatformRegistry');

describe('CLIST Integration & Resilience Test Suite', () => {
  const originalKey = process.env.CLIST_API_KEY;
  const originalUser = process.env.CLIST_USERNAME;

  beforeEach(() => {
    ClistClient.clearCache();
    process.env.CLIST_API_KEY = 'mock_test_api_key_12345';
    process.env.CLIST_USERNAME = 'mock_test_user';
  });

  afterAll(() => {
    process.env.CLIST_API_KEY = originalKey;
    process.env.CLIST_USERNAME = originalUser;
  });

  describe('1. Configuration & Auth Format Validation', () => {
    test('marks provider disabled when CLIST_API_KEY is missing', () => {
      delete process.env.CLIST_API_KEY;
      expect(ClistClient.isConfigured()).toBe(false);
      const health = ClistClient.getHealth();
      expect(health.configured).toBe(false);
      expect(health.status).toBe('disabled');
    });

    test('marks provider configured when CLIST_API_KEY is present', () => {
      expect(ClistClient.isConfigured()).toBe(true);
      const health = ClistClient.getHealth();
      expect(health.configured).toBe(true);
      expect(health.status).toBe('healthy');
    });

    test('generates correct Tastypie auth headers and parameters with username and key', () => {
      const auth = ClistClient._getAuthHeadersAndParams();
      expect(auth.headers['Authorization']).toBe('ApiKey mock_test_user:mock_test_api_key_12345');
      expect(auth.params['username']).toBe('mock_test_user');
      expect(auth.params['api_key']).toBe('mock_test_api_key_12345');
    });
  });

  describe('2. Provider Factory & Platform Registry Integration', () => {
    test('registers clist in PlatformRegistry', () => {
      const spec = registry.get('clist');
      expect(spec).not.toBeNull();
      expect(spec.name).toBe('clist');
      expect(spec.adapterName).toBe('clist');
    });

    test('retrieves ClistAdapter from AdapterFactory', () => {
      const adapter = getAdapter('clist');
      expect(adapter).toBeInstanceOf(ClistAdapterClass);
      expect(adapter.platformName).toBe('CLIST');
    });

    test('instantiates ClistAdapter from AttendanceProviderFactory for CLIST type', () => {
      const provider = AttendanceProviderFactory.getProvider('CLIST');
      expect(provider).toBeInstanceOf(ClistAdapterClass);
    });
  });

  describe('3. Response Normalization & Field Mapping', () => {
    test('normalizes raw CLIST contest objects into CodeTrack format', () => {
      const adapter = new ClistAdapterClass();
      const rawContest = {
        id: 51941985,
        event: 'Weekly Contest 400',
        key: 'weekly-contest-400',
        resource: 'leetcode.com',
        start: '2024-06-02T02:30:00',
        end: '2024-06-02T04:00:00',
        duration: 5400,
        href: 'https://leetcode.com/contest/weekly-contest-400'
      };

      const normalized = adapter.normalizeContest(rawContest);
      expect(normalized.id).toBe(51941985);
      expect(normalized.name).toBe('Weekly Contest 400');
      expect(normalized.slug).toBe('weekly-contest-400');
      expect(normalized.platform).toBe('clist');
      expect(normalized.originalPlatform).toBe('leetcode.com');
      expect(normalized.duration).toBe(5400);
      expect(normalized.url).toBe('https://leetcode.com/contest/weekly-contest-400');
    });

    test('normalizes raw CLIST statistics into CodeTrack participant format (score & solving fallback)', () => {
      const adapter = new ClistAdapterClass();
      const rawParticipant = {
        handle: 'john_doe',
        place: '12',
        score: 18.0,
        solving: 18.0,
        penalty: '3600',
        contest_id: 51941985
      };

      const normalized = adapter.normalizeParticipant(rawParticipant, 51941985);
      expect(normalized.contestId).toBe(51941985);
      expect(normalized.username).toBe('john_doe');
      expect(normalized.rank).toBe(12);
      expect(normalized.score).toBe(18.0);
      expect(normalized.penalty).toBe(3600);
      expect(normalized.platform).toBe('clist');
      expect(normalized.provider).toBe('clist');
    });
  });

  describe('4. Sync State & Early-Exit Optimization', () => {
    test('sets syncState = VERIFIED_FOR_REGISTERED_STUDENTS and leaderboardComplete = false on early exit', async () => {
      const adapter = new ClistAdapterClass();

      // Mock ClistClient.getContestParticipants
      jest.spyOn(ClistClient, 'getContestParticipants').mockResolvedValueOnce({
        meta: { limit: 1000, offset: 0, estimated_count: 8981, next: '/api/v4/statistics/?offset=1000' },
        objects: [
          { handle: 'alice', place: 1, score: 18 },
          { handle: 'bob', place: 2, score: 12 }
        ]
      });

      const res = await adapter.getContestParticipants(51941985, {
        registeredUsernames: ['alice', 'bob']
      });

      expect(res.syncState).toBe('VERIFIED_FOR_REGISTERED_STUDENTS');
      expect(res.leaderboardComplete).toBe(false); // MUST NEVER be treated as LEADERBOARD_COMPLETE
      expect(res.attendanceVerified).toBe(true);
      expect(res.length).toBe(2);

      ClistClient.getContestParticipants.mockRestore();
    });

    test('sets syncState = COMPLETE and leaderboardComplete = true when all pages finish', async () => {
      const adapter = new ClistAdapterClass();

      jest.spyOn(ClistClient, 'getContestParticipants').mockResolvedValueOnce({
        meta: { limit: 1000, offset: 0, estimated_count: 2, next: null },
        objects: [
          { handle: 'alice', place: 1, score: 18 },
          { handle: 'bob', place: 2, score: 12 }
        ]
      });

      const res = await adapter.getContestParticipants(51941985);

      expect(res.syncState).toBe('COMPLETE');
      expect(res.leaderboardComplete).toBe(true);
      expect(res.attendanceVerified).toBe(true);

      ClistClient.getContestParticipants.mockRestore();
    });

    test('sets syncState = PARTIAL and leaderboardComplete = false when pagination is interrupted', async () => {
      const adapter = new ClistAdapterClass();

      jest.spyOn(ClistClient, 'getContestParticipants').mockResolvedValueOnce({
        meta: { limit: 1000, offset: 0, estimated_count: 8981, next: '/api/v4/statistics/?offset=1000' },
        objects: [{ handle: 'alice', place: 1, score: 18 }]
      });

      const res = await adapter.getContestParticipants(51941985, {
        registeredUsernames: ['alice', 'charlie_unmatched'],
        maxPages: 1
      });

      expect(res.syncState).toBe('PARTIAL');
      expect(res.leaderboardComplete).toBe(false);
      expect(res.attendanceVerified).toBe(false);

      ClistClient.getContestParticipants.mockRestore();
    });

    test('sets syncState = UNAVAILABLE when API is disabled or unconfigured', async () => {
      delete process.env.CLIST_API_KEY;
      const adapter = new ClistAdapterClass();
      const res = await adapter.getContestParticipants(51941985);

      expect(res.syncState).toBe('UNAVAILABLE');
      expect(res.leaderboardComplete).toBe(false);
      expect(res.attendanceVerified).toBe(false);
    });
  });
});
