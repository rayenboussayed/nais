/**
 * Counting semaphore with an in-memory FIFO wait queue. Used to bound
 * concurrent model calls in the general AI pipeline (the queue worker already
 * serializes its jobs with batchSize 1; the REST path needed its own gate).
 */
export class Semaphore {
  /**
   * Number of permits currently in use.
   * @returns permits in use
   */
  get inFlight(): number {
    return this.capacity - this.permits;
  }
  /**
   * Number of callers currently waiting.
   * @returns waiters in the queue
   */
  get waiting(): number {
    return this.waiters.length;
  }

  private permits: number;

  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Semaphore capacity must be a positive integer');
    }
    this.permits = capacity;
  }

  /**
   * Blocks until a permit is available.
   * @returns nothing; resolves once a permit is held
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Returns a permit to the pool, waking the next waiter in line, if any. */
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.permits += 1;
  }

  /**
   * Runs `fn` holding one permit; releases it even on rejection.
   * @param fn - the async work to run under the permit
   * @returns the fn result
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
