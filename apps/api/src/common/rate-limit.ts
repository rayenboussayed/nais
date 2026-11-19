/**
 * Fixed-window rate limiter, keyed by caller identity. O(1) per hit, no
 * external state. Suitable for bounding WebSocket frames per connection.
 */
export class RateLimiter {
  /** Soft cap on tracked callers; stale windows are pruned lazily past this size. */
  private static readonly MAX_BUCKETS = 10_000;

  private readonly buckets = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Registers one hit for `key`.
   * @param key - the bucket key (client id)
   * @param now - current time in milliseconds
   * @returns true when the caller is within the limit, false when exceeded
   */
  hit(key: string, now: number = Date.now()): boolean {
    if (this.buckets.size >= RateLimiter.MAX_BUCKETS && !this.buckets.has(key)) {
      this.prune(now);
      // A window that is still active cannot be pruned; make room by evicting
      // the oldest tracked window. The requesting key is absent at this point
      // (checked above), so a full non-empty map always yields a victim.
      if (this.buckets.size >= RateLimiter.MAX_BUCKETS) this.evictOldest();
    }
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= this.limit) return false;
    bucket.count += 1;
    return true;
  }

  /**
   * Evicts the bucket with the oldest window start (approximate LRU).
   * Precondition: the requesting key is not tracked, so at least one victim exists.
   */
  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestStart = Infinity;
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowStart < oldestStart) {
        oldestStart = bucket.windowStart;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) this.buckets.delete(oldestKey);
  }

  /**
   * Drops windows that have fully elapsed; called only past the bucket cap.
   * @param now - current time in milliseconds
   */
  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) this.buckets.delete(key);
    }
  }
}
