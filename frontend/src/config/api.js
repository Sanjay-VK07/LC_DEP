import axios from 'axios';

/**
 * Normalizes the environment API URL to guarantee valid structure:
 * - Prevents trailing slashes
 * - Prevents missing /api path when a base domain URL is passed
 * - Prevents double /api/api paths
 */
function getNormalizedApiUrl() {
  const envUrl = import.meta.env.VITE_API_URL;
  if (!envUrl) {
    return '/api';
  }

  // Remove trailing slashes
  let clean = envUrl.trim().replace(/\/+$/, '');

  // If environment variable is just domain without /api (e.g. https://college-slov.onrender.com)
  if (clean.startsWith('http') && !clean.endsWith('/api') && !clean.includes('/api/')) {
    clean = `${clean}/api`;
  }

  return clean;
}

export const API_URL = getNormalizedApiUrl();

// Configure Axios default baseURL
axios.defaults.baseURL = API_URL;

// Centralized Axios instance
export const apiClient = axios.create({
  baseURL: API_URL,
});

export default API_URL;
