import type { Redis } from "ioredis";
import type { RateLimiter } from "@infergate/ratelimit";

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  ts = now
end
local refilled = math.min(capacity, tokens + (now - ts) * refill_per_ms)
if refilled < 1 then
  redis.call('HSET', key, 'tokens', refilled, 'ts', now)
  redis.call('PEXPIRE', key, 120000)
  return {0, 0, math.ceil((1 - refilled) / refill_per_ms)}
end
redis.call('HSET', key, 'tokens', refilled - 1, 'ts', now)
redis.call('PEXPIRE', key, 120000)
return {1, math.floor(refilled - 1), 0}
`;

export class RedisTokenBucket implements RateLimiter {
  private client: Redis;
  private capacity: number;
  private refillPerMs: number;
  private failOpen: boolean;

  constructor(client: Redis, capacity: number, refillPerMinute: number, failOpen: boolean) {
    this.client = client;
    this.capacity = capacity;
    this.refillPerMs = refillPerMinute / 60000;
    this.failOpen = failOpen;
  }

  async check(key: string): Promise<{ allowed: boolean; remaining: number; resetAfterMs: number }> {
    try {
      const res = (await this.client.eval(TOKEN_BUCKET_LUA, 1, key, this.capacity, this.refillPerMs, Date.now())) as [number, number, number];
      return { allowed: res[0] === 1, remaining: res[1], resetAfterMs: res[2] };
    } catch {
      if (this.failOpen) {
        return { allowed: true, remaining: this.capacity, resetAfterMs: 0 };
      }
      throw new Error("limiter_unavailable");
    }
  }
}
