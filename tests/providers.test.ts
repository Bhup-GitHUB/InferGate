import { describe, expect, test } from "bun:test";
import { assertEgressAllowed, createDefaultRegistry } from "@infergate/providers";
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

describe("egress", () => {
  const policy = { allowlist: ["api.openai.com", "*.anthropic.com"], allowLoopback: false };
  test("allows listed hosts and blocks metadata", () => {
    expect(() => assertEgressAllowed("https://api.openai.com/v1", policy)).not.toThrow();
    expect(() => assertEgressAllowed("https://api.anthropic.com/v1", policy)).not.toThrow();
    expect(() => assertEgressAllowed("https://deep.api.anthropic.com/v1", policy)).not.toThrow();
    expect(() => assertEgressAllowed("http://169.254.169.254/latest", { allowlist: ["169.254.169.254"], allowLoopback: true })).toThrow();
    expect(() => assertEgressAllowed("http://localhost:8000/x", policy)).toThrow();
    expect(() => assertEgressAllowed("https://evil.com/x", policy)).toThrow();
    expect(() => assertEgressAllowed("http://api.openai.com/v1", policy)).toThrow();
    expect(() => assertEgressAllowed("https://2130706433/x", { allowlist: ["2130706433"], allowLoopback: false })).toThrow();
    expect(() => assertEgressAllowed("https://0x7f.0.0.1/x", { allowlist: ["0x7f.0.0.1"], allowLoopback: false })).toThrow();
    expect(() => assertEgressAllowed("https://10.0.0.5/x", { allowlist: ["10.0.0.5"], allowLoopback: false })).toThrow();
    expect(() => assertEgressAllowed("https://[::1]/x", { allowlist: ["[::1]"], allowLoopback: false })).toThrow();
    expect(() => assertEgressAllowed("https://user:pass@api.openai.com/x", policy)).toThrow();
    expect(() => assertEgressAllowed("https://api.openai.com:8443/x", policy)).toThrow();
    expect(() => assertEgressAllowed("https://api.openai.com./x", policy)).not.toThrow();
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
