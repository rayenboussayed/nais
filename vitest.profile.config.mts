import { defineConfig } from 'vitest/config';

import baseConfig from './vitest.config.mts';

// Mirrors jutilities' profile config for CPU/heap profiling runs.
export default defineConfig({
  test: {
    ...baseConfig.test,
    coverage: { enabled: false },
    execArgv: ['--cpu-prof', '--cpu-prof-dir=profiles', '--heap-prof', '--heap-prof-dir=profiles'],
    fileParallelism: false,
    isolate: false,
    maxWorkers: 1,
  },
});
