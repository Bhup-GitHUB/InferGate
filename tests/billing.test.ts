import { describe, expect, test } from "bun:test";
import { buildInvoice, capsFor, checkQuota, monthKey, monthWindow, rollupDaily } from "@infergate/billing";
import { generateKey } from "@infergate/auth";
import { createApp } from "../apps/gateway/src/app";

const PEPPER = "billing-test-pepper-01";

describe("billing", () => {
  test("quota allows under caps denies over", () => {
    const ok = checkQuota("free", 10, 0.01, Date.now());
    expect(ok.allowed).toBe(true);
    const over = checkQuota("free", 2000000, 0.01, Date.now());
    expect(over.allowed).toBe(false);
    const spend = checkQuota("free", 10, 99, Date.now());
    expect(spend.allowed).toBe(false);
    expect(capsFor("unknown").plan).toBe("free");
    expect(monthKey(Date.now()).length).toBe(7);
  });

  test("rollup buckets by day ignoring errors", () => {
    const now = Date.now();
    const rows = [
      { model: "m", inputTokens: 10, outputTokens: 5, costUsd: 0.001, status: "ok", createdAt: now },
      { model: "m", inputTokens: 10, outputTokens: 5, costUsd: 0.001, status: "error", createdAt: now },
    ];
    const buckets = rollupDaily(rows, 1, now);
    expect(buckets.length).toBe(1);
    expect(buckets[0].requests).toBe(1);
    const invoice = buildInvoice(rows, "2026-09-01", "2026-09");
    expect(invoice.amountUsd).toBe(0.001);
    expect(invoice.status).toBe("draft");
  });

  test("org plan upgrades quota", async () => {    const handles = createApp({ API_KEY_PEPPER: PEPPER, PEPPER_VERSION: "1", RATE_LIMIT_PER_MINUTE: "1000" });
    const g = generateKey("org_plan", ["chat:write", "keys:write", "billing:read"], PEPPER, 1);
    await handles.keys.save({ id: crypto.randomUUID(), createdAt: Date.now(), ...g.record });
    const headers = { authorization: `Bearer ${g.publicKey}`, "content-type": "application/json" };
    const bad = await handles.app.request("/v1/org/plan", { method: "POST", headers, body: JSON.stringify({ plan: "ultra" }) });
    expect(bad.status).toBe(400);
    const ok = await handles.app.request("/v1/org/plan", { method: "POST", headers, body: JSON.stringify({ plan: "enterprise" }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).plan).toBe("enterprise");
  });

  test("gateway blocks over-quota org with 402", async () => {
    const handles = createApp({ API_KEY_PEPPER: PEPPER, PEPPER_VERSION: "1", RATE_LIMIT_PER_MINUTE: "1000" });
    const g = generateKey("org_broke", ["chat:write", "billing:read"], PEPPER, 1);
    await handles.keys.save({ id: crypto.randomUUID(), createdAt: Date.now(), ...g.record });
    const { start } = monthWindow(Date.now());
    void start;
    await handles.usage.insert({
      idempotencyKey: null, orgId: "org_broke", keyId: null, providerId: "openai", model: "gpt-4o",
      inputTokens: 900000, outputTokens: 900000, latencyMs: 10, costUsd: 0.01, status: "ok", error: null,
    });
    const res = await handles.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${g.publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe("quota_exceeded");
  });

  test("daily and summary endpoints reflect spend", async () => {
    const handles = createApp({ API_KEY_PEPPER: PEPPER, PEPPER_VERSION: "1", RATE_LIMIT_PER_MINUTE: "1000" });
    const g = generateKey("org_paid", ["chat:write", "usage:read", "billing:read"], PEPPER, 1);
    await handles.keys.save({ id: crypto.randomUUID(), createdAt: Date.now(), ...g.record });
    handles.plans.set("org_paid", "pro");
    const headers = { authorization: `Bearer ${g.publicKey}`, "content-type": "application/json" };
    const chat = await handles.app.request("/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hello billing" }] }),
    });
    expect(chat.status).toBe(200);
    const daily = await handles.app.request("/v1/usage/daily?days=7", { headers: { authorization: `Bearer ${g.publicKey}` } });
    expect(daily.status).toBe(200);
    const dbody = await daily.json();
    expect(dbody.days.length).toBe(7);
    expect(dbody.days.reduce((n: number, d: { requests: number }) => n + d.requests, 0)).toBe(1);
    const summary = await handles.app.request("/v1/billing/summary", { headers: { authorization: `Bearer ${g.publicKey}` } });
    expect(summary.status).toBe(200);
    const sbody = await summary.json();
    expect(sbody.plan).toBe("pro");
    expect(sbody.tokensUsed).toBeGreaterThan(0);
    expect(sbody.invoice.status).toBe("draft");
  });

  test("crossing 80 percent emits quota warning", async () => {
    const handles = createApp({ API_KEY_PEPPER: PEPPER, PEPPER_VERSION: "1", RATE_LIMIT_PER_MINUTE: "1000" });
    const g = generateKey("org_warn", ["chat:write"], PEPPER, 1);
    await handles.keys.save({ id: crypto.randomUUID(), createdAt: Date.now(), ...g.record });
    const hookServer = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    await handles.webhooks.add("org_warn", `http://localhost:${hookServer.port}/hook`, "0123456789abcdef", ["quota.warning"]);
    await handles.usage.insert({
      idempotencyKey: null, orgId: "org_warn", keyId: null, providerId: "openai", model: "gpt-4o",
      inputTokens: 850000, outputTokens: 0, latencyMs: 10, costUsd: 0.5, status: "ok", error: null,
    });
    const res = await handles.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${g.publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    const warnings = handles.notify.deliveries("org_warn").filter((d) => d.type === "quota.warning");
    expect(warnings.length).toBe(1);
    expect(warnings[0].ok).toBe(true);
    hookServer.stop(true);
  });
});
