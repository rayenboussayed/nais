import { describe, expect, it } from 'vitest';

import { Semaphore } from './semaphore.js';

describe('Semaphore', () => {
  it('rejects invalid capacities', () => {
    expect(() => new Semaphore(0)).toThrow(/positive integer/);
    expect(() => new Semaphore(1.5)).toThrow(/positive integer/);
  });

  it('allows up to `capacity` concurrent holders', async () => {
    const semaphore = new Semaphore(2);
    const held = await Promise.all([
      semaphore.acquire().then(() => 'a'),
      semaphore.acquire().then(() => 'b'),
    ]);
    expect(held).toEqual(['a', 'b']);
    expect(semaphore.inFlight).toBe(2);

    let released = false;
    const third = semaphore.acquire().then(() => {
      released = true;
    });
    // Not resolved yet: both permits are held.
    await Promise.resolve();
    expect(released).toBe(false);

    semaphore.release();
    await third;
    expect(released).toBe(true);
    expect(semaphore.inFlight).toBe(2);
  });

  it('queues waiters FIFO', async () => {
    const semaphore = new Semaphore(1);
    const order: string[] = [];
    await semaphore.acquire();
    const a = semaphore.acquire().then(() => order.push('a'));
    const b = semaphore.acquire().then(() => order.push('b'));
    semaphore.release();
    await a;
    semaphore.release();
    await b;
    expect(order).toEqual(['a', 'b']);
  });

  it('releases the permit even when the wrapped function rejects', async () => {
    const semaphore = new Semaphore(1);
    await expect(
      semaphore.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(semaphore.inFlight).toBe(0);
    await expect(semaphore.run(async () => 'ok')).resolves.toBe('ok');
  });
});
