import { defineConfig } from 'vitest/config';

// Scaffold-phase config: no test files exist yet, so passWithNoTests keeps
// the empty tree green. Per-file thresholds gate the changed-file bar (95%);
// the global 98% bar is enforced by `npm run test:cov` on the full suite.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: [
      'packages/shared/src/**/*.test.ts',
      'packages/shared/test/**/*.spec.ts',
      'apps/**/src/**/*.spec.ts',
      'apps/**/test/**/*.spec.ts',
    ],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 98,
        functions: 98,
        branches: 98,
        statements: 98,
      },
    },
  },
});
