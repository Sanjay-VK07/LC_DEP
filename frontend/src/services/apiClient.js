import axios from 'axios';
import { API_URL } from '../config/api';

const requestCache = new Map();

/**
 * Fetch unified student CP profile, caching the promise and response to deduplicate concurrent requests.
 * @param {number|string} studentId
 * @param {boolean} forceRefresh - If true, triggers a live background scraping sync first.
 */
export async function fetchUnifiedProfile(studentId, forceRefresh = false) {
  if (!studentId) return null;
  
  const cacheKey = String(studentId);
  const promiseKey = `promise-${cacheKey}`;
  
  // If not forcing refresh, check memory cache and ongoing promises
  if (!forceRefresh) {
    if (requestCache.has(cacheKey)) {
      return requestCache.get(cacheKey);
    }
    if (requestCache.has(promiseKey)) {
      return requestCache.get(promiseKey);
    }
  } else {
    // Evict old entries to ensure fresh data is fetched
    requestCache.delete(cacheKey);
    requestCache.delete(promiseKey);
  }

  const promise = (async () => {
    try {
      const url = forceRefresh
        ? `${API_URL}/students/${studentId}/unified-profile?refresh=true`
        : `${API_URL}/students/${studentId}/unified-profile`;
        
      const res = await axios.get(url);
      if (res.data && res.data.success) {
        const profileData = res.data.data;
        requestCache.set(cacheKey, profileData);
        // Evict from cache after 2 minutes
        setTimeout(() => {
          if (requestCache.get(cacheKey) === profileData) {
            requestCache.delete(cacheKey);
          }
        }, 2 * 60 * 1000);
        return profileData;
      }
      throw new Error(res.data?.message || 'Failed to retrieve unified profile data');
    } finally {
      if (requestCache.get(promiseKey) === promise) {
        requestCache.delete(promiseKey);
      }
    }
  })();

  requestCache.set(promiseKey, promise);
  return promise;
}

/**
 * Clear the cache for a student ID.
 */
export function invalidateProfileCache(studentId) {
  const cacheKey = String(studentId);
  requestCache.delete(cacheKey);
  requestCache.delete(`promise-${cacheKey}`);
}
