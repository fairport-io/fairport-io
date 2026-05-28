import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/server/**/*.test.ts'],
    setupFiles: ['tests/server/setup.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});
