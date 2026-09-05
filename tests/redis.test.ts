import { describe, expect, test } from "bun:test";
import { Redis } from "ioredis";
import { acquireLock, cacheGet, cacheSet, releaseLock } from "@infergate/cache";
import { RedisTokenBucket } from "@infergate/cache";

const REDIS_URL = process.env["TEST_REDIS_URL"] ?? "";
const describeRedis = REDIS_URL === "" ? describe.skip : describe;

describeRedis("redis coordination", () => {
  test("lua token bucket allows then blocks", async () => {
    const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
    const bucket = new RedisTokenBucket(client, 3, 60, false);
    const key = `test:bucket:${Date.now()}`;
    expect((await bucket.check(key)).allowed).toBe(true);
    expect((await bucket.check(key)).allowed).toBe(true);
    expect((await bucket.check(key)).allowed).toBe(true);
    const fourth = await bucket.check(key);
    expect(fourth.allowed).toBe(false);
    expect(fourth.resetAfterMs).toBeGreaterThan(0);
    await client.del(key);
    await client.quit();
  });

  test("response cache roundtrips with ttl", async () => {
    const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
    const key = `test:cache:${Date.now()}`;
    expect(await cacheGet(client, key)).toBeNull();
    await cacheSet(client, key, { text: "hi", inputTokens: 2, outputTokens: 3, costUsd: 0.001, providerId: "openai", modelId: "m" }, 60);
    const hit = await cacheGet(client, key);
    expect(hit?.text).toBe("hi");
    await client.del(key);
    await client.quit();
  });

  test("locks exclude and release", async () => {
    const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
    const key = `test:lock:${Date.now()}`;
    const first = await acquireLock(client, key, 5000);
    expect(first).not.toBeNull();
    const second = await acquireLock(client, key, 5000);
    expect(second).toBeNull();
    await releaseLock(client, first!);
    const third = await acquireLock(client, key, 5000);
    expect(third).not.toBeNull();
    await releaseLock(client, third!);
    await client.quit();
  });
});
