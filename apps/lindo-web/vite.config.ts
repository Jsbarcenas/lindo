import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Ankama's haapi preflight never allows the `apikey` header - it answers
      // with `access-control-request-headers` where `Access-Control-Allow-Headers`
      // belongs - so the browser blocks the account call that follows a login.
      // Going through this origin sidesteps CORS entirely. `server.mjs` does the
      // same thing in production.
      '/haapi': {
        target: 'https://haapi.ankama.com',
        changeOrigin: true,
        rewrite: (route) => route.replace(/^\/haapi/, '')
      }
    }
  },
  resolve: {
    // Under pnpm every package resolves its own copy, and a second React
    // instance breaks hooks in a way that only shows up at runtime. The desktop
    // renderer states the same guarantee.
    dedupe: ['react', 'react-dom']
  }
})
