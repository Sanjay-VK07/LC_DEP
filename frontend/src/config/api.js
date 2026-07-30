import axios from 'axios';

/**
 * Normalizes the API URL for development and production environments.
 * - In production: Uses VITE_API_URL (e.g., https://college-slov.onrender.com/api)
 * - In local development: Uses VITE_API_URL if provided, or defaults to '/api'
 *   (which uses Vite's local dev server proxy to target http://localhost:3001)
 */
function getNormalizedApiUrl() {
  const envUrl = import.meta.env.VITE_API_URL;
  
  if (!envUrl) {
    return '/api';
  }

  // Remove trailing slashes
  let clean = envUrl.trim().replace(/\/+$/, '');

  // If environment variable is domain without /api
  if (clean.startsWith('http') && !clean.endsWith('/api') && !clean.includes('/api/')) {
    clean = `${clean}/api`;
  }

  return clean;
}

export const API_URL = getNormalizedApiUrl();

// Configure Axios default baseURL
axios.defaults.baseURL = API_URL;
axios.defaults.timeout = 90000; // 30 second timeout for cold starts

// Centralized Axios instance
export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 90000,
});

// Response interceptor for clear Network Error diagnostics
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.message === 'Network Error' || !error.response) {
      console.error(
        '[API Network Error] Could not connect to API server at:', API_URL,
        'Please ensure backend server is running and CORS is configured.'
      );
    }
    return Promise.reject(error);
  }
);

export default API_URL;
