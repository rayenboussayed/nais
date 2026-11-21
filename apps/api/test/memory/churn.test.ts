import { describe, expect, it } from 'vitest';

import { Inflight } from '../../src/utils/inflight.js';
import { RateLimiter } from '../../src/utils/rate-limit.js';

const ITERATIONS = 200;
const BUCKETS = 10_000;
const CONCURRENCY = 16;
const HEAP_BUDGET_MB = 10;

/** Results of the churn loops; written here so the engine cannot elide them. */
let consumed: unknown;

/**
 * Memory smoke for bounded churn: the rate limiter and the inflight registry
 * must stay flat as identities come and go in a long-lived process. Runs with
 * --expose-gc (see vitest.memory.config.mts). A real model and database are out
 * of scope; this is a smoke bound, not a proof of absence of leaks.
 */
describe('memory: bounded caller churn', () => {
  it('keeps the limiter and inflight registry flat across many keys', async () => {
    const limiter = new RateLimiter(4, 60_000);
    // Fill to the cap with active windows (now=0) so every later fresh key
    // takes the O(n) prune + evict path and the bucket map never grows.
    for (let i = 0; i < BUCKETS; i += 1) {
      consumed = limiter.hit(`caller-${i}`, 0);
    }

    global.gc?.();
    const before = process.memoryUsage().heapUsed;

    const inflight = new Inflight<string, number>();
    for (let i = 0; i < ITERATIONS; i += 1) {
      // A fresh key at the cap with an active window forces eviction, not insert.
      consumed = limiter.hit(`fresh-${i}`, 0);
      const pending: Array<Promise<number>> = [];
      for (let j = 0; j < CONCURRENCY; j += 1) {
        pending.push(inflight.run(`key-${i}-${j}`, async () => j));
      }
      consumed = await Promise.all(pending);
    }
    expect(inflight.size).toBe(0);
    expect(consumed).toBeDefined();

    global.gc?.();
    const after = process.memoryUsage().heapUsed;
    const deltaMb = (after - before) / (1024 * 1024);

    expect(deltaMb).toBeLessThan(HEAP_BUDGET_MB);
  }, 30_000);
});
