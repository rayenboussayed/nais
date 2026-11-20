import { describe, test } from 'vitest';

import type { Database } from '../src/db/drizzle.module.js';

import { LanguagesService } from '../src/resources/languages/languages.service.js';

/** Row returned by the benchmark DB double on every lookup. */
const ROW = {
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
  dir: 'ltr',
  id: '123e4567-e89b-42d3-a456-426655440000',
  iso6391: 'en',
  isSource: true,
  name: 'English',
  nativeName: 'English',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} as const;

/**
 * Builds a drizzle-shaped DB double whose select returns the given rows.
 * @param rows - rows to return from the findByIso select
 * @returns a Database double
 */
function languageDb(rows: Array<typeof ROW>) {
  // Double implements only the select chain findByIso uses; this is the same
  // test-double pattern already used in languages.service.spec.ts.
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  } as unknown as Database;
}

// Microbenchmark of the ISO-code memoization on the translate request path.
// Run: npm run test:perf
// Save a baseline with: npm run test:perf -- --reporter=json --outputFile=<path>

describe('LanguagesService.findByIso', () => {
  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; assertions inside the loop would distort the timing
  test('cached hit returns the memoized row', async ({ bench }) => {
    const service = new LanguagesService(languageDb([ROW]));
    await service.findByIso('en'); // prime the single cache entry
    await bench('cached lookup', () => service.findByIso('en')).run();
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; assertions inside the loop would distort the timing
  test('uncached miss pays the database query', async ({ bench }) => {
    // A missing iso returns null, which the memoizer deliberately does not
    // store, so every iteration exercises the full query path with no growth.
    const service = new LanguagesService(languageDb([]));
    await bench('uncached lookup', () => service.findByIso('missing')).run();
  });
});
