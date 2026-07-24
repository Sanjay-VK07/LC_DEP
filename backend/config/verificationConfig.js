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
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '1000', 10);

module.exports = {
  // Feature Flags
  ENABLE_PLATFORM_VALIDATION,
  ENABLE_CACHE,
  ENABLE_IMPORT_AUDIT,
  ENABLE_IMPORT_REPORTS,
  ENABLE_STRUCTURED_LOGGING,
  ENABLE_BACKGROUND_VERIFICATION,

  // Policy & Expiration Settings
  VALIDATION_POLICY,
  VERIFICATION_CACHE_DAYS,
  VALIDATION_BATCH_SIZE,
  MAX_RETRIES,
  RETRY_DELAY_MS
};
