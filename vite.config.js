import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Never ship source maps to production: they hand the full pre-minified source tree to
    // anyone with DevTools. Kept explicit so a future config change can't silently re-enable them.
    sourcemap: false,
  },
})
