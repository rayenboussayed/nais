import { describe, expect, it, vi } from 'vitest';

import { Inflight } from './inflight';

describe('Inflight', () => {
  it('shares one execution between concurrent callers', async () => {
    const inflight = new Inflight<string, number>();
    const fn = vi.fn(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return 42;
    });

    const [a, b, c] = await Promise.all([
      inflight.run('k', fn),
      inflight.run('k', fn),
      inflight.run('k', fn),
    ]);

    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(c).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-runs after the first settles', async () => {
    const inflight = new Inflight<string, number>();
    const fn = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await inflight.run('k', fn);
    const second = await inflight.run('k', fn);

    expect(second).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not cache rejections', async () => {
    const inflight = new Inflight<string, number>();
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(7);

    await expect(inflight.run('k', fn)).rejects.toThrow('boom');
    await expect(inflight.run('k', fn)).resolves.toBe(7);
  });

  it('removes the entry once settled', async () => {
    const inflight = new Inflight<string, number>();
    await inflight.run('k', async () => 1);
    expect(inflight.size).toBe(0);
  });

  it('dedupes different keys independently', async () => {
    const inflight = new Inflight<string, number>();
    const fn = vi.fn(async (key: string) => key.length);
    // map the fn signature once per call to keep TS happy
    const results = await Promise.all([
      inflight.run('aaaa', () => fn('aaaa')),
      inflight.run('bb', () => fn('bb')),
    ]);
    expect(results).toEqual([4, 2]);
  });
});
