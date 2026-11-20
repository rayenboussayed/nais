import { describe, test } from 'vitest';

import { changedFields as changedFieldsFn } from '../src/utils/changed-fields.js';
import { Inflight } from '../src/utils/inflight.js';
import { translationKeyFor as translationKeyForFn } from '../src/utils/key.js';
import { RateLimiter } from '../src/utils/rate-limit.js';
import {
  escapeLike as escapeLikeFn,
  keysetWhere as keysetWhereFn,
  timestamptzCursor,
} from '../src/utils/sql.js';

// Resolve export getters once so the benchmark loop does not pay for them.
const translationKeyFor = translationKeyForFn;
const escapeLike = escapeLikeFn;
const keysetWhere = keysetWhereFn;
const changedFields = changedFieldsFn;

/**
 * Microbenchmarks for the hot, pure paths on every request and model call.
 * Run: npm run test:perf
 * Save a baseline with: npx vitest bench --reporter=json --outputFile=bench-baseline.json
 * Vitest 5 has no --compare flag; save current results to a second JSON file
 * with the same command and diff the two reports to compare.
 */

describe('translationKeyFor', () => {
  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('hashes a typical source sentence', async ({ bench }) => {
    await bench('nfc + sha512 + base64url', () => {
      translationKeyFor('The quick brown fox jumps over the lazy dog');
    }).run();
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('hashes a long multi-line input', async ({ bench }) => {
    await bench('long input', () => {
      translationKeyFor('Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40));
    }).run();
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('normalizes decomposed unicode before hashing', async ({ bench }) => {
    await bench('decomposed unicode', () => {
      translationKeyFor('cafe\u0301 au lait \u0301');
    }).run();
  });
});

describe('escapeLike', () => {
  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('escapes a short search term', async ({ bench }) => {
    await bench('escapeLike short', () => {
      escapeLike('100%_guarantee');
    }).run();
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('escapes a long pattern', async ({ bench }) => {
    await bench('escapeLike long', () => {
      escapeLike('%'.repeat(256));
    }).run();
  });
});

describe('keysetWhere', () => {
  const column = { name: 'created_at' } as never;
  const id = { name: 'id' } as never;

  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('builds the ascending comparator', async ({ bench }) => {
    await bench('keyset asc', () => {
      keysetWhere(
        column,
        id,
        'asc',
        '2026-11-18T00:00:00.000000+00',
        '123e4567-e89b-42d3-a456-426655440000',
      );
    }).run();
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('builds the descending comparator', async ({ bench }) => {
    await bench('keyset desc', () => {
      keysetWhere(
        column,
        id,
        'desc',
        '2026-11-18T00:00:00.000000+00',
        '123e4567-e89b-42d3-a456-426655440000',
      );
    }).run();
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('builds the cursor expression', async ({ bench }) => {
    // bench only exercises the builder path; the SQL is covered by integration tests
    await bench('timestamptzCursor', () => {
      timestamptzCursor({ name: 'created_at' } as never);
    }).run();
  });
});

describe('changedFields', () => {
  // A nested object field forces valuesEqual() down its object branch, so the
  // benchmark actually exercises canonicalJsonStringify's sorted-key recursion.
  const before = {
    dir: 'ltr',
    iso6391: 'en',
    isSource: true,
    meta: { aliases: ['en', 'eng'], script: { code: 'Latn', rtl: false } },
    name: 'English',
    nativeName: 'English',
    text: 'x'.repeat(500),
  };

  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('returns an empty object for identical patches', async ({ bench }) => {
    await bench('no-op patch', () => {
      changedFields(before, {
        ...before,
        meta: { aliases: ['en', 'eng'], script: { code: 'Latn', rtl: false } },
      });
    }).run();
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('returns changed fields for divergent patches', async ({ bench }) => {
    await bench('changed patch', () => {
      changedFields(before, {
        ...before,
        isSource: false,
        meta: { aliases: ['en', 'eng'], script: { code: 'Latn', rtl: true } },
        name: 'German',
      });
    }).run();
  });
});

describe('Inflight', () => {
  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('registers and settles a deduped call', async ({ bench }) => {
    const inflight = new Inflight<string, number>();
    await bench('inflight run', async () => {
      await inflight.run('key', async () => 42);
    }).run();
  });
});

describe('RateLimiter', () => {
  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('allows a hit within the window', async ({ bench }) => {
    const limiter = new RateLimiter(10, 60_000);
    await bench('hit within window', () => {
      limiter.hit('caller', 0);
    }).run();
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('rejects a hit over the limit', async ({ bench }) => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.hit('caller', 0);
    await bench('hit over limit', () => {
      limiter.hit('caller', 1);
    }).run();
  });
});
