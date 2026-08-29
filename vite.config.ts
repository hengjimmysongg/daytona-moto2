import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Served from the site root on Netlify. Absolute asset paths keep working
  // when the SPA fallback serves index.html for a deep link.
  base: '/',
  server: {
    // `netlify dev` normally fronts both halves. This proxy is the fallback
    // for running the two separately: `npm run dev:api` beside `npm run dev`.
    proxy: {
      '/api': {
        target: 'http://localhost:9999',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
