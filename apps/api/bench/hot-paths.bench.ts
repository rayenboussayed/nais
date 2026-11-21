import { ConfigService } from '@nestjs/config';
import { describe, expect, test, vi } from 'vitest';

const transformersMock = vi.hoisted(() => ({
  pipeline: vi.fn(),
}));

const webgpuGlobalsMock = vi.hoisted(() => ({
  ensureWebgpuGlobals: vi.fn(),
}));

// Stub the native load so the dedup path can be measured without downloading
// a model or importing onnxruntime.
vi.mock('@huggingface/transformers', () => ({ pipeline: transformersMock.pipeline }));
vi.mock('../src/resources/ai/webgpu-globals.js', () => ({
  ensureWebgpuGlobals: webgpuGlobalsMock.ensureWebgpuGlobals,
}));

import type { Env } from '../src/environment.js';

import { PipelineLoader } from '../src/resources/ai/pipeline-loader.js';
import { Inflight } from '../src/utils/inflight.js';
import { taskKeyFor } from '../src/utils/key.js';
import { RateLimiter } from '../src/utils/rate-limit.js';
import { canonicalJsonStringify } from '../src/utils/stable-json.js';

const DEEP_DEPTH = 12;
const WIDE_DEPTH = 6;
const WIDE_BRANCH = 4;

// Local aliases avoid Vite's module-runner getter overhead inside timed loops.
const canonicalize = canonicalJsonStringify;
const hashKey = taskKeyFor;

// Timed callbacks write here so the engine cannot eliminate their results.
let consumed: unknown;

/**
 * Builds a nested payload with unicode values for canonicalization benchmarks.
 * @param depth - remaining nesting levels
 * @param branch - children per node
 * @param path - path segment that keeps generated keys and values distinct
 * @returns a nested payload object
 */
function nestedPayload(depth: number, branch: number, path: string): Record<string, unknown> {
  if (depth === 0) {
    return { note: `café — ${path}`.repeat(3) };
  }
  const node: Record<string, unknown> = { title: `naïve ${path}` };
  for (let i = 0; i < branch; i += 1) {
    Reflect.set(node, `child_${i}`, nestedPayload(depth - 1, branch, `${path}_${i}`));
  }
  return node;
}

// Microbenchmarks of the allocation-heavy hot paths touched by the service
// refactor. Run: npm run test:perf. Assertions live in setup, outside the
// timed loop, so they do not distort the measured throughput.

describe('RateLimiter bucket churn', () => {
  test('evicts and prunes at the 10k bucket cap', async ({ bench }) => {
    const limiter = new RateLimiter(4, 60_000);
    // Fill to the cap with active windows so every new key takes the O(n)
    // prune + evict path rather than the O(1) insert path.
    for (let i = 0; i < 10_000; i += 1) {
      limiter.hit(`caller-${i}`, 0);
    }
    expect(limiter.hit('caller-0', 0)).toBe(true);
    let next = 0;
    await bench('new key at cap', () => {
      // A fresh key each call keeps the map at the cap; now=0 keeps all windows
      // active so prune() cannot reclaim a slot and evictOldest() must run.
      limiter.hit(`fresh-${next}`, 0);
      next += 1;
    }).run();
  });
});

describe('canonicalJsonStringify', () => {
  test('sorts a deeply nested, unicode-bearing object', async ({ bench }) => {
    const payload = nestedPayload(DEEP_DEPTH, 2, 'root');
    const canonical = canonicalize(payload);
    expect(canonical.startsWith('{"child_0"')).toBe(true);
    await bench('deep nested', () => {
      consumed = canonicalize(payload);
    }).run();
    expect(typeof consumed).toBe('string');
  });

  test('serializes an empty object', async ({ bench }) => {
    expect(canonicalize({})).toBe('{}');
    await bench('empty', () => {
      consumed = canonicalize({});
    }).run();
    expect(consumed).toBe('{}');
  });
});

describe('taskKeyFor', () => {
  test('hashes a large nested input with many distinct keys', async ({ bench }) => {
    const input = nestedPayload(WIDE_DEPTH, WIDE_BRANCH, 'root');
    const key = hashKey('sentiment', 'model-x', input);
    expect(key).toMatch(/^[\w-]+$/);
    await bench('large nested input', () => {
      consumed = hashKey('sentiment', 'model-x', input);
    }).run();
    expect(typeof consumed).toBe('string');
  });
});

describe('Inflight', () => {
  test('tracks many distinct concurrent keys', async ({ bench }) => {
    const inflight = new Inflight<string, number>();
    expect(inflight.size).toBe(0);
    await bench('high-cardinality concurrent', async () => {
      const pending: Array<Promise<number>> = [];
      for (let i = 0; i < 64; i += 1) {
        pending.push(inflight.run(`key-${i}`, async () => i));
      }
      await Promise.all(pending);
    }).run();
    expect(inflight.size).toBe(0);
  });
});

describe('PipelineLoader', () => {
  test('reuses the cached pipeline promise on repeated loads', async ({ bench }) => {
    transformersMock.pipeline.mockResolvedValue(async () => ({}));
    webgpuGlobalsMock.ensureWebgpuGlobals.mockResolvedValue(undefined);
    const loader = new PipelineLoader(new ConfigService<Env, true>());
    const first = await loader.load('sentiment');
    expect(typeof first).toBe('function');
    await bench('dedup (cached)', async () => {
      consumed = await loader.load('sentiment');
    }).run();
    expect(typeof consumed).toBe('function');
  });
});
