import { describe, expect, it } from 'vitest';

import { changedFields } from '../../src/utils/changed-fields.js';
import { Inflight } from '../../src/utils/inflight.js';
import { taskKeyFor } from '../../src/utils/key.js';
import { canonicalJsonStringify } from '../../src/utils/stable-json.js';

const ITERATIONS = 100;
const HEAP_BUDGET_MB = 10;
const TREE_DEPTH = 12;
const BRANCH = 2;

/** Results of the loop bodies; written here so the engine cannot elide them. */
let consumed: unknown;

/**
 * Builds a deep, wide payload with unicode values to mimic a large AI task input.
 * @param depth - remaining nesting levels
 * @param path - path segment that keeps generated keys and values distinct
 * @returns a nested payload object
 */
function nestedPayload(depth: number, path: string): Record<string, unknown> {
  if (depth === 0) {
    return { note: `café — ${path}`.repeat(4) };
  }
  const node: Record<string, unknown> = { title: `naïve ${path}` };
  for (let i = 0; i < BRANCH; i += 1) {
    Reflect.set(node, `child_${i}`, nestedPayload(depth - 1, `${path}_${i}`));
  }
  return node;
}

/**
 * Memory smoke for nested payloads: hashing, canonicalization and deep
 * comparison in a long-lived process must not accumulate heap. Runs with
 * --expose-gc (see vitest.memory.config.mts). A real model and database are
 * out of scope; this is a smoke bound, not a proof of absence of leaks.
 */
describe('memory: nested payload hot paths', () => {
  it('stays under the heap budget after many nested operations', async () => {
    const before = nestedPayload(TREE_DEPTH, 'root');
    const patch = nestedPayload(TREE_DEPTH, 'root');

    // Warm up the allocator and the JIT.
    for (let i = 0; i < 20; i += 1) {
      consumed = taskKeyFor('sentiment', 'model-x', before);
      consumed = canonicalJsonStringify(before);
      consumed = changedFields(before, patch);
    }
    global.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;

    const inflight = new Inflight<string, string>();
    const pending: Array<Promise<string>> = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const key = taskKeyFor('sentiment', 'model-x', before);
      consumed = key;
      consumed = canonicalJsonStringify(before);
      consumed = changedFields(before, patch);
      pending.push(inflight.run(`key-${i}`, async () => key));
    }
    // Let every tracked promise settle and the .finally() bookkeeping run
    // before sampling the heap.
    await Promise.all(pending);
    expect(inflight.size).toBe(0);
    expect(consumed).toBeDefined();

    global.gc?.();
    const heapAfter = process.memoryUsage().heapUsed;
    const deltaMb = (heapAfter - heapBefore) / (1024 * 1024);

    expect(deltaMb).toBeLessThan(HEAP_BUDGET_MB);
  }, 30_000);
});
