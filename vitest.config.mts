import { defineConfig } from 'vitest/config';

// passWithNoTests keeps the empty tree green on scaffold; drops out naturally
// once suites land everywhere. Per-file 95% gates changed files; global 95%
// never regresses. (The decorator-emitted branch in a trivial terminus
// controller is not coverable; 100% lines/functions/statements are held.)
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: [
      'packages/shared/src/**/*.test.ts',
      'packages/shared/test/**/*.spec.ts',
      'apps/**/src/**/*.spec.ts',
      'apps/**/src/**/*.test.{ts,tsx}',
      'apps/**/test/**/*.spec.ts',
    ],
    passWithNoTests: true,
    // The integration specs each create a throwaway PostgreSQL cluster and boot
    // the full Nest app; under parallel workers that exceeds hook timeouts on
    // busy machines. Serial files keep the gate deterministic everywhere
    // (CI runner included). Wall time is higher but bounded.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      exclude: [
        '**/node_modules/**',
        // v8 cannot map rolldown-compiled JSX (upstream vitest#10475), so .tsx
        // produces partial, misleading numbers; behavior is asserted by the
        // jsdom component tests instead.
        '**/*.tsx',
        '**/routeTree.gen.ts', // generated
        'apps/api/src/main.ts', // boot entrypoint; exercised by the e2e suite instead
        'apps/api/test/memory/**', // measured by test:mem instead
      ],
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
