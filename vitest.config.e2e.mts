import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: { enabled: false },
    environment: 'node',
    globals: false,
    hookTimeout: 30_000,
    include: ['apps/api/test/e2e/**/*.spec.ts'],
    passWithNoTests: true,
    testTimeout: 30_000,
  },
});
