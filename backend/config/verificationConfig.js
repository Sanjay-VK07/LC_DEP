/**
 * Centralized Configuration for Platform Verification Architecture
 */

const ENABLE_PLATFORM_VALIDATION = process.env.ENABLE_PLATFORM_VALIDATION !== 'false';
const ENABLE_CACHE = process.env.ENABLE_CACHE !== 'false';
const ENABLE_IMPORT_AUDIT = process.env.ENABLE_IMPORT_AUDIT !== 'false';
const ENABLE_IMPORT_REPORTS = process.env.ENABLE_IMPORT_REPORTS !== 'false';
const ENABLE_STRUCTURED_LOGGING = process.env.ENABLE_STRUCTURED_LOGGING !== 'false';
const ENABLE_BACKGROUND_VERIFICATION = process.env.ENABLE_BACKGROUND_VERIFICATION === 'true';

const VALIDATION_POLICY = (process.env.VALIDATION_POLICY || 'STRICT').toUpperCase(); // STRICT, SOFT, DISABLED
const VERIFICATION_CACHE_DAYS = parseInt(process.env.VERIFICATION_CACHE_DAYS || '30', 10);
const VALIDATION_BATCH_SIZE = parseInt(process.env.VALIDATION_BATCH_SIZE || '20', 10);
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || '100', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '1000', 10);
const VERIFICATION_QUEUE_MAX_SIZE = parseInt(process.env.VERIFICATION_QUEUE_MAX_SIZE || '1000', 10);

// Platform-Specific Concurrency Limits
const PLATFORM_CONCURRENCY = {
  leetcode: parseInt(process.env.LEETCODE_CONCURRENCY || '3', 10),
  codechef: parseInt(process.env.CODECHEF_CONCURRENCY || '2', 10),
  codeforces: parseInt(process.env.CODEFORCES_CONCURRENCY || '2', 10),
  hackerrank: parseInt(process.env.HACKERRANK_CONCURRENCY || '1', 10)
};

// Platform-Specific Request Intervals (Token Bucket / Rate Limiter in ms)
const PLATFORM_REQUEST_INTERVAL_MS = {
  leetcode: parseInt(process.env.LEETCODE_REQUEST_INTERVAL_MS || '500', 10),
  codechef: parseInt(process.env.CODECHEF_REQUEST_INTERVAL_MS || '2000', 10),
  codeforces: parseInt(process.env.CODEFORCES_REQUEST_INTERVAL_MS || '1000', 10),
  hackerrank: parseInt(process.env.HACKERRANK_REQUEST_INTERVAL_MS || '2000', 10)
};

// Platform-Specific Burst Capacities
const PLATFORM_BURST_CAPACITY = {
  leetcode: parseInt(process.env.LEETCODE_BURST_CAPACITY || '3', 10),
  codechef: parseInt(process.env.CODECHEF_BURST_CAPACITY || '2', 10),
  codeforces: parseInt(process.env.CODEFORCES_BURST_CAPACITY || '2', 10),
  hackerrank: parseInt(process.env.HACKERRANK_BURST_CAPACITY || '1', 10)
};

// Platform-Specific Timeouts (in ms)
const PLATFORM_TIMEOUTS = {
  leetcode: parseInt(process.env.LEETCODE_TIMEOUT_MS || '20000', 10),
  codechef: parseInt(process.env.CODECHEF_TIMEOUT_MS || '30000', 10),
  codeforces: parseInt(process.env.CODEFORCES_TIMEOUT_MS || '20000', 10),
  hackerrank: parseInt(process.env.HACKERRANK_TIMEOUT_MS || '30000', 10)
};

// Recommended Platform Cache TTLs (in seconds)
// LeetCode: 24h, CodeChef: 12h, Codeforces: 6h, HackerRank: 24h
const PLATFORM_CACHE_TTL_SECONDS = {
  leetcode: parseInt(process.env.LEETCODE_CACHE_TTL || String(24 * 3600), 10),
  codechef: parseInt(process.env.CODECHEF_CACHE_TTL || String(12 * 3600), 10),
  codeforces: parseInt(process.env.CODEFORCES_CACHE_TTL || String(6 * 3600), 10),
  hackerrank: parseInt(process.env.HACKERRANK_CACHE_TTL || String(24 * 3600), 10)
};

// Circuit Breaker Configurations
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: parseInt(process.env.CIRCUIT_FAILURE_THRESHOLD || '5', 10),
  cooldownMs: parseInt(process.env.CIRCUIT_COOLDOWN_MS || '300000', 10) // 5 minutes default
};

// Exponential Backoff for 429 & Transient Errors
const RETRY_BACKOFF_SCHEDULE = [2000, 4000, 8000]; // Retry 1: 2s, Retry 2: 4s, Retry 3: 8s
const RETRY_JITTER_MAX = [500, 1000, 2000]; // Jitter max per attempt

module.exports = {
  // Feature Flags
  ENABLE_PLATFORM_VALIDATION,
  ENABLE_CACHE,
  ENABLE_IMPORT_AUDIT,
  ENABLE_IMPORT_REPORTS,
  ENABLE_STRUCTURED_LOGGING,
  ENABLE_BACKGROUND_VERIFICATION,

  // Policy & General Settings
  VALIDATION_POLICY,
  VERIFICATION_CACHE_DAYS,
  VALIDATION_BATCH_SIZE,
  BATCH_DELAY_MS,
  MAX_RETRIES,
  RETRY_DELAY_MS,
  VERIFICATION_QUEUE_MAX_SIZE,

  // Platform Specs
  PLATFORM_CONCURRENCY,
  PLATFORM_REQUEST_INTERVAL_MS,
  PLATFORM_BURST_CAPACITY,
  PLATFORM_TIMEOUTS,
  PLATFORM_CACHE_TTL_SECONDS,
  CIRCUIT_BREAKER_CONFIG,
  RETRY_BACKOFF_SCHEDULE,
  RETRY_JITTER_MAX
};
