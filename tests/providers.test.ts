import { describe, expect, test } from "bun:test";
import { createDefaultRegistry } from "@infergate/providers";
import { MemoryTokenBucket } from "@infergate/ratelimit";

describe("providers", () => {
  test("registry resolves models and adapters", () => {
    const registry = createDefaultRegistry();
    expect(registry.listModels().length).toBeGreaterThan(0);
    expect(registry.resolveModel("gpt-4o-mini")?.providerId).toBe("openai");
    expect(registry.resolveModel("nope")).toBeUndefined();
    expect(registry.adapterFor("gpt-4o-mini")?.id).toBe("openai");
    expect(registry.adapterFor("auto")?.id).toBe("openai");
    expect(registry.adapterFor("nope")).toBeUndefined();
  });

  test("mock chat completion returns usage", async () => {
    const registry = createDefaultRegistry();
    const adapter = registry.adapterFor("llama-3-8b");
    const result = await adapter!.chatCompletion(
      { model: "llama-3-8b", messages: [{ role: "user", content: "hello world" }], orgId: "org_1" },
      new AbortController().signal,
    );
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  test("mock stream ends done with usage", async () => {
    const registry = createDefaultRegistry();
    const adapter = registry.adapterFor("gpt-4o-mini");
    const chunks = [];
    for await (const c of adapter!.streamCompletion(
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "stream me" }], orgId: "org_1" },
      new AbortController().signal,
    )) {
      chunks.push(c);
    }
    const last = chunks[chunks.length - 1];
    expect(last.done).toBe(true);
    expect(last.usage?.outputTokens).toBeGreaterThan(0);
  });

  test("abort stops chat completion", async () => {
    const registry = createDefaultRegistry();
    const adapter = registry.get("openai")!;
    const controller = new AbortController();
    const pending = adapter.chatCompletion(
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "abort me please" }], orgId: "org_1" },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});

describe("ratelimit", () => {
  test("allows then blocks at capacity", async () => {
    const limiter = new MemoryTokenBucket({ capacity: 2, refillPerMinute: 60 });
    expect((await limiter.check("k")).allowed).toBe(true);
    expect((await limiter.check("k")).allowed).toBe(true);
    const third = await limiter.check("k");
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });
});
