import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    setupFiles: ['test/setup.js'],
    // Hver testfil har sin egen databasefil; de må gerne køre samtidig.
    testTimeout: 20000,
  },
})
