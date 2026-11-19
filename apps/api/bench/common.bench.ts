import { describe, test } from 'vitest';

import { changedFields as changedFieldsFn } from '../src/common/changed-fields.js';
import {
  escapeLike as escapeLikeFn,
  keysetWhere as keysetWhereFn,
  timestamptzCursor,
} from '../src/common/sql.js';
import { translationKeyFor as translationKeyForFn } from '../src/common/key.js';
import { Inflight } from '../src/common/inflight.js';
import { RateLimiter } from '../src/common/rate-limit.js';

// Resolve export getters once so the benchmark loop does not pay for them.
const translationKeyFor = translationKeyForFn;
const escapeLike = escapeLikeFn;
const keysetWhere = keysetWhereFn;
const changedFields = changedFieldsFn;

/**
 * Microbenchmarks for the hot, pure paths on every request and model call.
 * Run: npm run test:perf
 * Compare against a saved baseline with: npm run test:perf -- --outputJson bench-baseline.json
 */

describe('translationKeyFor', () => {
  test('hashes a typical source sentence', async ({ bench }) => {
    await bench('nfc + sha512 + base64url', () => {
      translationKeyFor('The quick brown fox jumps over the lazy dog');
    }).run();
  });

  test('hashes a long multi-line input', async ({ bench }) => {
    await bench('long input', () => {
      translationKeyFor('Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40));
    }).run();
  });

  test('normalizes decomposed unicode before hashing', async ({ bench }) => {
    await bench('decomposed unicode', () => {
      translationKeyFor('cafe\u0301 au lait \u0301');
    }).run();
  });
});

describe('escapeLike', () => {
  test('escapes a short search term', async ({ bench }) => {
    await bench('escapeLike short', () => {
      escapeLike('100%_guarantee');
    }).run();
  });

  test('escapes a long pattern', async ({ bench }) => {
    await bench('escapeLike long', () => {
      escapeLike('%'.repeat(256));
    }).run();
  });
});

describe('keysetWhere', () => {
  const column = { name: 'created_at' } as never;
  const id = { name: 'id' } as never;

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

  test('builds the cursor expression', async ({ bench }) => {
    // bench only exercises the builder path; the SQL is covered by integration tests
    await bench('timestamptzCursor', () => {
      timestamptzCursor({ name: 'created_at' } as never);
    }).run();
  });
});

describe('changedFields', () => {
  const before = {
    name: 'English',
    nativeName: 'English',
    iso6391: 'en',
    dir: 'ltr',
    isSource: true,
    text: 'x'.repeat(500),
  };

  test('returns an empty object for identical patches', async ({ bench }) => {
    await bench('no-op patch', () => {
      changedFields(before, { ...before });
    }).run();
  });

  test('returns changed fields for divergent patches', async ({ bench }) => {
    await bench('changed patch', () => {
      changedFields(before, { ...before, name: 'German', isSource: false });
    }).run();
  });
});

describe('Inflight', () => {
  test('registers and settles a deduped call', async ({ bench }) => {
    const inflight = new Inflight<string, number>();
    await bench('inflight run', async () => {
      await inflight.run('key', async () => 42);
    }).run();
  });
});

describe('RateLimiter', () => {
  test('allows a hit within the window', async ({ bench }) => {
    const limiter = new RateLimiter(10, 60_000);
    await bench('hit within window', () => {
      limiter.hit('caller', 0);
    }).run();
  });

  test('rejects a hit over the limit', async ({ bench }) => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.hit('caller', 0);
    await bench('hit over limit', () => {
      limiter.hit('caller', 1);
    }).run();
  });
});
