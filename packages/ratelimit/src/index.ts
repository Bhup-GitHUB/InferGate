export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAfterMs: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitDecision>;
}

export interface TokenBucketOptions {
  capacity: number;
  refillPerMinute: number;
}

export class MemoryTokenBucket implements RateLimiter {
  private buckets = new Map<string, { tokens: number; updatedAt: number }>();
  private capacity: number;
  private refillPerMs: number;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerMinute / 60000;
  }

  async check(key: string): Promise<RateLimitDecision> {
    const now = Date.now();
    const entry = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    const elapsed = now - entry.updatedAt;
    const refilled = Math.min(this.capacity, entry.tokens + elapsed * this.refillPerMs);
    if (refilled < 1) {
      const resetAfterMs = Math.ceil((1 - refilled) / this.refillPerMs);
      this.buckets.set(key, { tokens: refilled, updatedAt: now });
      return { allowed: false, remaining: 0, resetAfterMs };
    }
    const remaining = Math.floor(refilled - 1);
    this.buckets.set(key, { tokens: refilled - 1, updatedAt: now });
    return { allowed: true, remaining, resetAfterMs: 0 };
  }
}

export function createRateLimiter(redisUrl: string | undefined, options: TokenBucketOptions): RateLimiter {
  void redisUrl;
  return new MemoryTokenBucket(options);
}
