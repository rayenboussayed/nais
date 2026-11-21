import { describe, expect, it } from 'vitest';

import { RateLimiter } from './rate-limit.js';

describe('RateLimiter', () => {
  it('allows up to the limit within a window', () => {
    const limiter = new RateLimiter(3, 1_000);
    expect(limiter.hit('a', 0)).toBe(true);
    expect(limiter.hit('a', 100)).toBe(true);
    expect(limiter.hit('a', 200)).toBe(true);
    expect(limiter.hit('a', 300)).toBe(false);
  });

  it('resets after the window elapses', () => {
    const limiter = new RateLimiter(2, 1_000);
    limiter.hit('a', 0);
    limiter.hit('a', 0);
    expect(limiter.hit('a', 0)).toBe(false);
    expect(limiter.hit('a', 1_001)).toBe(true);
  });

  it('defaults the timestamp to Date.now() when none is supplied', () => {
    const limiter = new RateLimiter(2, 1_000);
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(false);
  });

  it('treats the exact window boundary as a new window', () => {
    const limiter = new RateLimiter(1, 1_000);
    expect(limiter.hit('a', 0)).toBe(true);
    expect(limiter.hit('a', 999)).toBe(false);
    expect(limiter.hit('a', 1_000)).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = new RateLimiter(1, 1_000);
    expect(limiter.hit('a', 0)).toBe(true);
    expect(limiter.hit('b', 0)).toBe(true);
    expect(limiter.hit('a', 0)).toBe(false);
  });

  it('prunes stale windows once the bucket cap is reached', () => {
    const limiter = new RateLimiter(1, 1_000);
    const cap = 10_000;
    // Fill to the cap with long-expired windows.
    for (let i = 0; i < cap; i += 1) limiter.hit(`stale-${i}`, 0);

    // A fresh hit past the cap sweeps stale entries and admits the caller.
    expect(limiter.hit('fresh', cap + 1_000)).toBe(true);

    // The pruned buckets were dropped: a stale key acts like a brand-new caller.
    expect(limiter.hit('stale-1', cap + 1_000)).toBe(true);
  });

  it('keeps fresh buckets when pruning past the cap', () => {
    const limiter = new RateLimiter(1, 60_000);
    for (let i = 0; i < 10_000; i += 1) limiter.hit(`keep-${i}`, 100);

    // All windows are fresh: nothing may be pruned, enforcement still applies.
    expect(limiter.hit('keep-1', 100)).toBe(false);
  });

  it('evicts the oldest window when the cap is reached and nothing can be pruned', () => {
    const limiter = new RateLimiter(1, 3_600_000);
    // 10_000 distinct callers, all in one long window: prune frees nothing.
    for (let i = 0; i < 10_000; i += 1) limiter.hit(`fresh-${i}`, 100);

    // The new caller must still get in: the oldest window is evicted to make room.
    expect(limiter.hit('newcomer', 200)).toBe(true);
    // The eviction made room without dropping fresh callers wholesale:
    expect(limiter.hit('fresh-1', 200)).toBe(false);
  });
});

describe('RateLimiter.evictOldest defensive path', () => {
  it('does nothing when asked to evict from an empty bucket map', () => {
    const limiter = new RateLimiter(1, 1_000);
    const evict = Reflect.get(limiter, 'evictOldest') as () => void;

    expect(() => evict.call(limiter)).not.toThrow();
    expect(limiter.hit('a', 0)).toBe(true);
  });
});
