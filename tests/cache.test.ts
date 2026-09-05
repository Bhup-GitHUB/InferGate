import { describe, expect, test } from "bun:test";
import { acquireLock, cacheKey, cacheGet, cacheSet, releaseLock } from "@infergate/cache";

describe("cache", () => {
  test("cache keys isolate orgs and params", () => {
    const a = cacheKey("org1", "m", [{ role: "user", content: "hi" }], undefined, 0.7);
    const b = cacheKey("org2", "m", [{ role: "user", content: "hi" }], undefined, 0.7);
    const c = cacheKey("org1", "m", [{ role: "user", content: "bye" }], undefined, 0.7);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  test("null client degrades to miss and local lock", async () => {
    expect(await cacheGet(null, "k")).toBeNull();
    await cacheSet(null, "k", { text: "t", inputTokens: 1, outputTokens: 1, costUsd: 0, providerId: "p", modelId: "m" }, 60);
    const lock = await acquireLock(null, "k", 1000);
    expect(lock).not.toBeNull();
    await releaseLock(null, lock!);
  });
});
