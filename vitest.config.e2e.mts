import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['apps/api/test/e2e/**/*.spec.ts'],
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: { enabled: false },
  },
});
