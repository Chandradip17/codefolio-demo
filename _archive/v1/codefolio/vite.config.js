import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// All data comes from the Codefolio API (../server, Express + Supabase).
// In dev/preview, /api is proxied to it so the browser stays same-origin.
// In production, either deploy behind the same origin or set VITE_API_URL.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy = {
    '/api': { target: env.API_PROXY_TARGET || 'http://localhost:4000', changeOrigin: true },
  }
  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  }
})
