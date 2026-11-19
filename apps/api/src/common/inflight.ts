/**
 * Single-flight deduplication for concurrent identical async work: the first
 * caller runs `fn`, the rest share its result; the entry is removed once it
 * settles, so rejection never caches failure.
 */
export class Inflight<K, V> {
  /**
   * Number of in-flight operations (mostly for tests and introspection).
   * @returns the number of in-flight keys
   */
  get size(): number {
    return this.pending.size;
  }

  private readonly pending = new Map<K, Promise<V>>();

  /**
   * @param key - dedup key; callers with the same key share one promise
   * @param fn - the work to run exactly once per pending key
   * @returns the shared promise for this key
   */
  run(key: K, fn: () => Promise<V>): Promise<V> {
    const existing = this.pending.get(key);
    if (existing) return existing;

    const promise = fn().finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, promise);
    return promise;
  }
}
