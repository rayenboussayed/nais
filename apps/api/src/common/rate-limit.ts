/**
 * Fixed-window rate limiter, keyed by caller identity. O(1) per hit, no
 * external state. Suitable for bounding WebSocket frames per connection.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { count: number; windowStart: number }>();

  /** Soft cap on tracked callers; stale windows are pruned lazily past this size. */
  private static readonly MAX_BUCKETS = 10_000;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Registers one hit for `key`.
   *
   * @returns true when the caller is within the limit, false when exceeded
   */
  hit(key: string, now: number = Date.now()): boolean {
    if (this.buckets.size >= RateLimiter.MAX_BUCKETS) this.prune(now);
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= this.limit) return false;
    bucket.count += 1;
    return true;
  }

  /** Drops windows that have fully elapsed; called only past the bucket cap. */
  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) this.buckets.delete(key);
    }
  }
}
