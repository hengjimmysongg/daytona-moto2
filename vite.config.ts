import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Served from the site root. Absolute asset paths keep working when the
  // SPA fallback serves index.html for a deep link.
  base: '/',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
