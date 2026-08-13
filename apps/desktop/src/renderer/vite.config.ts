import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from '../../package.json'

/**
 * The renderer talks to the main process exclusively through window.lindoAPI,
 * exposed by the preload over contextBridge. It imports neither electron nor any
 * Node builtin, so it needs no shims for them.
 *
 * @see https://vitejs.dev/config/
 */
export default defineConfig({
  mode: process.env.NODE_ENV,
  root: __dirname,
  plugins: [
    react({
      jsxImportSource: '@emotion/react',
      babel: {
        plugins: ['@emotion/babel-plugin']
      }
    })
  ],
  // cf issue: https://github.com/vitejs/vite/issues/8644
  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' }
  },
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: true
  },
  resolve: {
    // react is a peer of @lindo/i18n, @lindo/ui and @lindo/client-store, so
    // under pnpm each resolves it through its own node_modules. Every path
    // lands on the same version today, but deduping is what guarantees a
    // single React instance - two would break hooks in a way that only shows
    // up at runtime. Same reasoning for emotion, which MUI's ThemeProvider
    // carries its context on.
    dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/styled']
  },
  server: {
    host: pkg.env.VITE_DEV_SERVER_HOST,
    port: pkg.env.VITE_DEV_SERVER_PORT
  }
})
