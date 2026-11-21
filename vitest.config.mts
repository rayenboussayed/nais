import { defineConfig } from 'vitest/config';

// Every authored source file in the two workspaces is in the denominator.
// Istanbul is required because v8 silently drops uncovered .tsx files when
// Rolldown parses them as plain JavaScript (upstream vitest#10475). Generated
// artifacts are verified by regeneration + git diff gates in CI instead.
export default defineConfig({
  test: {
    coverage: {
      exclude: [
        '**/node_modules/**',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        '**/routeTree.gen.ts',
        'generated/**',
      ],
      include: ['apps/api/src/**/*.ts', 'apps/web/src/**/*.{ts,tsx}'],
      provider: 'istanbul',
      reporter: ['text', 'json-summary'],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        perFile: true,
        statements: 100,
      },
    },
    environment: 'node',
    // Integration specs each boot a throwaway PostgreSQL cluster; serial files
    // keep CI hook timeouts deterministic.
    fileParallelism: false,
    globals: false,
    include: [
      'apps/**/src/**/*.spec.ts',
      'apps/**/src/**/*.test.{ts,tsx}',
      'apps/**/test/**/*.spec.ts',
    ],
    passWithNoTests: true,
  },
});
