import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Determine proxy target: if VITE_API_URL is an absolute URL, strip trailing /api;
  // otherwise default to local backend at http://localhost:3001
  let backendTarget = 'http://localhost:3001';
  if (env.VITE_API_URL && env.VITE_API_URL.startsWith('http')) {
    const cleaned = env.VITE_API_URL.replace(/\/api\/?$/, '');
    if (cleaned) {
      backendTarget = cleaned;
    }
  } else if (env.VITE_BACKEND_URL && env.VITE_BACKEND_URL.startsWith('http')) {
    backendTarget = env.VITE_BACKEND_URL;
  }

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
        }
      }
    },
    build: {
      target: 'esnext',
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('chart.js') || id.includes('recharts') || id.includes('react-chartjs-2')) {
                return 'charts-vendor';
              }
              if (id.includes('xlsx') || id.includes('jspdf') || id.includes('file-saver')) {
                return 'export-vendor';
              }
              return 'vendor';
            }
          }
        }
      }
    }
  };
})
