import { describe, expect, test } from "bun:test";
import { CircuitBreaker, HealthTracker, RoutingEngine } from "@infergate/routing";

function engine(): RoutingEngine {
  const e = new RoutingEngine({ failureThreshold: 3, cooldownMs: 50, backoffBaseMs: 10 });
  e.registerProvider("openai", { costPer1k: 0.0015, aliases: ["gpt-4o-mini", "auto"] });
  e.registerProvider("anthropic", { costPer1k: 0.0024, aliases: ["claude-3-5-sonnet", "auto"] });
  e.registerProvider("local-vllm", { costPer1k: 0.0002, aliases: ["llama-3-8b", "auto"] });
  return e;
}

describe("routing", () => {
  test("cost strategy picks cheapest", () => {
    const e = engine();
    const ordered = e.orderCandidates(["openai", "anthropic", "local-vllm"], "cost", e.ruleFor("org", "auto"));
    expect(ordered[0].providerId).toBe("local-vllm");
  });

  test("latency strategy picks fastest ewma", () => {
    const e = engine();
    e.reportSuccess("openai", 400);
    e.reportSuccess("local-vllm", 40);
    const ordered = e.orderCandidates(["openai", "local-vllm"], "latency", e.ruleFor("org", "auto"));
    expect(ordered[0].providerId).toBe("local-vllm");
  });

  test("availability strategy avoids failing provider", () => {
    const e = engine();
    e.reportFailure("openai");
    e.reportFailure("openai");
    e.reportSuccess("local-vllm", 50);
    const ordered = e.orderCandidates(["openai", "local-vllm"], "availability", e.ruleFor("org", "auto"));
    expect(ordered[0].providerId).toBe("local-vllm");
  });

  test("priority strategy follows rule order", () => {
    const e = engine();
    e.setRules([{ orgId: null, modelAlias: "auto", strategy: "priority", weights: {}, priority: ["anthropic", "openai"], maxAttempts: 2 }]);
    const rule = e.ruleFor("org", "auto");
    expect(rule.strategy).toBe("priority");
    const ordered = e.orderCandidates(["openai", "anthropic", "local-vllm"], "priority", rule);
    expect(ordered[0].providerId).toBe("anthropic");
  });

  test("open circuit removes provider from pool", () => {
    const e = engine();
    e.reportFailure("openai");
    e.reportFailure("openai");
    e.reportFailure("openai");
    expect(e.circuitState("openai")).toBe("open");
    const ordered = e.orderCandidates(["openai", "local-vllm"], "availability", e.ruleFor("org", "auto"));
    expect(ordered[0].providerId).toBe("local-vllm");
  });

  test("breaker half-opens after cooldown", async () => {
    const b = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 20 });
    b.recordFailure();
    expect(b.isOpen).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(b.snapshot).toBe("half-open");
    b.recordSuccess();
    expect(b.snapshot).toBe("closed");
  });

  test("health tracker ewma moves toward samples", () => {
    const h = new HealthTracker();
    h.recordSuccess("p", 100);
    h.recordSuccess("p", 100);
    const s = h.snapshot("p", false, "closed", 1);
    expect(s.ewmaLatencyMs).toBe(100);
    expect(s.consecutiveFailures).toBe(0);
  });

  test("all circuits open yields empty pool", () => {
    const e = new RoutingEngine({ failureThreshold: 1, cooldownMs: 60000, backoffBaseMs: 10 });
    e.registerProvider("openai", { costPer1k: 0.0015, aliases: ["auto"] });
    e.registerProvider("local-vllm", { costPer1k: 0.0002, aliases: ["auto"] });
    e.reportFailure("openai");
    e.reportFailure("local-vllm");
    const ordered = e.orderCandidates(["openai", "local-vllm"], "availability", e.ruleFor("org", "auto"));
    expect(ordered.length).toBe(0);
  });

  test("org rule matches requested alias", () => {
    const e = engine();
    e.setRules([{ orgId: "org1", modelAlias: "auto", strategy: "cost", weights: {}, priority: [], maxAttempts: 2 }]);
    const rule = e.ruleFor("org1", "auto", "gpt-4o-mini");
    expect(rule.strategy).toBe("cost");
  });
  test("backoff grows exponentially capped", () => {
    const e = engine();
    expect(e.backoffFor(0)).toBe(10);
    expect(e.backoffFor(1)).toBe(20);
    expect(e.backoffFor(20)).toBe(1000);
  });
});
