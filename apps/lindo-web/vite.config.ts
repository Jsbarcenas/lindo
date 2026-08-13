import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Under pnpm every package resolves its own copy, and a second React
    // instance breaks hooks in a way that only shows up at runtime. The desktop
    // renderer states the same guarantee.
    dedupe: ['react', 'react-dom']
  }
})
