import { defineConfig } from 'vitest/config';

import baseConfig from './vitest.config.mts';

// Mirrors jutilities' memory config: GC exposed, serial execution, coverage off.
export default defineConfig({
  test: {
    ...baseConfig.test,
    coverage: { enabled: false },
    execArgv: ['--expose-gc'],
    fileParallelism: false,
    include: ['apps/api/test/memory/**/*.test.ts'],
    passWithNoTests: true,
  },
});
