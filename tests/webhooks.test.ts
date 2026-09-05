import { describe, expect, test } from "bun:test";
import { buildEvent, retryDelays, sign, verify, WebhookQueue } from "../packages/webhooks/src/index";

describe("webhooks", () => {
  test("sign verify roundtrip passes", () => {
    const payload = JSON.stringify(buildEvent("quota.warning", "org_123", { percentUsed: 82 }));
    const secret = "whsec_test_secret";
    const sig = sign(payload, secret);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verify(sig, payload, secret)).toBe(true);
  });

  test("tampered payload or wrong secret fails", () => {
    const payload = JSON.stringify(buildEvent("quota.exceeded", "org_123", { plan: "free" }));
    const secret = "whsec_correct";
    const sig = sign(payload, secret);
    expect(verify(sig, payload + " ", secret)).toBe(false);
    expect(verify(sig, payload, "whsec_wrong")).toBe(false);
    expect(verify("deadbeef", payload, secret)).toBe(false);
  });

  test("queue due matches subscribed events only", () => {
    const q = new WebhookQueue();
    q.register("https://a.example/hook", "s1", ["quota.warning"]);
    q.register("https://b.example/hook", "s2", ["quota.exceeded", "provider.outage"]);
    expect(q.due("quota.warning").map((e) => e.url)).toEqual(["https://a.example/hook"]);
    expect(q.due("quota.exceeded").map((e) => e.url)).toEqual(["https://b.example/hook"]);
    expect(q.due("provider.outage").map((e) => e.url)).toEqual(["https://b.example/hook"]);
    expect(q.due("quota.warning")).toHaveLength(1);
  });

  test("backoff values are fixed schedule", () => {
    expect(retryDelays()).toEqual([1000, 5000, 30000]);
    expect(new WebhookQueue().retryDelays()).toEqual([1000, 5000, 30000]);
  });
});
