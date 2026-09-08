import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { config } from 'dotenv'

// Load .env into process.env so live integration tests can read Supabase keys
config({ path: path.resolve(__dirname, '.env') })

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
