import { describe, expect, it } from 'vitest';

import { changedFields } from '../../src/common/changed-fields';
import { translationKeyFor } from '../../src/common/key';
import { escapeLike } from '../../src/common/sql';
import { Inflight } from '../../src/common/inflight';

/**
 * Memory smoke: a long-lived process must not accumulate heap across many
 * translate-shaped operations. Runs with --expose-gc (see
 * vitest.memory.config.mts). A real model and database are out of scope; the
 * loop exercises the same allocation shapes the hot path produces. This is a
 * smoke bound, not a proof of absence of leaks.
 */

const ITERATIONS = 100;
const HEAP_BUDGET_MB = 10;

describe('memory: repeated translate operations', () => {
  it('stays under the heap budget after many iterations', async () => {
    // Warm up the allocator and the JIT.
    for (let i = 0; i < 20; i += 1) {
      translationKeyFor(`warmup ${i}`);
      changedFields({ text: `warmup ${i}`, n: i }, { text: `warmup ${i}`, n: i });
      escapeLike(`%${i}_ گرم`);
    }
    global.gc?.();
    const before = process.memoryUsage().heapUsed;

    const inflight = new Inflight<string, number>();
    const pending: Array<Promise<number>> = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const key = translationKeyFor(`benchmark text ${i} — lorem ipsum dolor sit amet ${i}`);
      void escapeLike(`search term ${i}%_${i}`);
      changedFields({ key, text: 'abc', n: i }, { key, text: 'abc', n: i });
      pending.push(inflight.run(`key-${i}`, async () => i));
    }
    // Let every tracked promise settle and the .finally() bookkeeping run
    // before sampling the heap.
    await Promise.all(pending);
    expect(inflight.size).toBe(0);

    global.gc?.();
    const after = process.memoryUsage().heapUsed;
    const deltaMb = (after - before) / (1024 * 1024);

    expect(deltaMb).toBeLessThan(HEAP_BUDGET_MB);
  });
});
