/**
 * Plugin-based Platform Registry for Competitive Programming Platforms
 */
const { VERIFICATION_CACHE_DAYS, MAX_RETRIES } = require('../config/verificationConfig');

class PlatformRegistry {
  constructor() {
    this.platforms = new Map();
    this._registerDefaults();
  }

  _registerDefaults() {
    this.register({
      name: 'leetcode',
      adapterName: 'leetcode',
      regex: /^[a-zA-Z0-9_-]{3,30}$/,
      cacheDays: VERIFICATION_CACHE_DAYS,
      timeout: 5000,
      retryCount: MAX_RETRIES,
      enabled: true,
      caseSensitive: false
    });

    this.register({
      name: 'codechef',
      adapterName: 'codechef',
      regex: /^[a-zA-Z0-9_]{3,30}$/,
      cacheDays: VERIFICATION_CACHE_DAYS,
      timeout: 5000,
      retryCount: MAX_RETRIES,
      enabled: true,
      caseSensitive: false
    });

    this.register({
      name: 'codeforces',
      adapterName: 'codeforces',
      regex: /^[a-zA-Z0-9_.-]{3,24}$/,
      cacheDays: VERIFICATION_CACHE_DAYS,
      timeout: 5000,
      retryCount: MAX_RETRIES,
      enabled: true,
      caseSensitive: true
    });

    this.register({
      name: 'hackerrank',
      adapterName: 'hackerrank',
      regex: /^[a-zA-Z0-9_.-]{3,30}$/,
      cacheDays: VERIFICATION_CACHE_DAYS,
      timeout: 5000,
      retryCount: MAX_RETRIES,
      enabled: true,
      caseSensitive: false
    });
  }

  /**
   * Register a platform configuration
   */
  register(config) {
    if (!config || !config.name) {
      throw new Error('[PlatformRegistry] Invalid platform registration specification: name required');
    }
    const name = String(config.name).toLowerCase().trim();
    const spec = {
      name,
      adapterName: config.adapterName || config.adapter || name,
      regex: config.regex || /^[a-zA-Z0-9_.-]{3,50}$/,
      cacheDays: config.cacheDays || VERIFICATION_CACHE_DAYS,
      timeout: config.timeout || 5000,
      retryCount: config.retryCount || MAX_RETRIES,
      enabled: config.enabled !== false,
      caseSensitive: config.caseSensitive === true
    };
    this.platforms.set(name, spec);
  }

  /**
   * Get platform specification
   */
  get(platformName) {
    if (!platformName) return null;
    const name = String(platformName).toLowerCase().trim();
    return this.platforms.get(name) || null;
  }

  /**
   * List all registered enabled platform names
   */
  listEnabled() {
    const list = [];
    for (const [name, spec] of this.platforms.entries()) {
      if (spec.enabled) list.push(name);
    }
    return list;
  }

  /**
   * Check if platform is registered
   */
  has(platformName) {
    return this.get(platformName) !== null;
  }
}

// Singleton instance
const registry = new PlatformRegistry();

module.exports = registry;
