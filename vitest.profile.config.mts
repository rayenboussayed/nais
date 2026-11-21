import { defineConfig } from 'vitest/config';

import baseConfig from './vitest.config.mts';

// Profiles benchmarks only. The base config's test globs include PostgreSQL
// integration specs, which would boot throwaway clusters under the profiler.
export default defineConfig({
  benchmark: {
    include: ['apps/api/bench/**/*.bench.ts'],
  },
  test: {
    ...baseConfig.test,
    coverage: { enabled: false },
    execArgv: ['--cpu-prof', '--cpu-prof-dir=profiles', '--heap-prof', '--heap-prof-dir=profiles'],
    fileParallelism: false,
    isolate: false,
    maxWorkers: 1,
    passWithNoTests: false,
  },
});
