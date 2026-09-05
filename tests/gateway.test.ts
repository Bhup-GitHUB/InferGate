import { describe, expect, test } from "bun:test";
import { generateKey } from "@infergate/auth";
import { createApp } from "../apps/gateway/src/app";

const PEPPER = "integration-pepper";

async function setup() {
  const handles = createApp({ API_KEY_PEPPER: PEPPER, PEPPER_VERSION: "1", RATE_LIMIT_PER_MINUTE: "1000" });
  const g = generateKey("org_test", ["chat:write", "models:read", "usage:read", "keys:write"], PEPPER, 1);
  const keyId = crypto.randomUUID();
  await handles.keys.save({ id: keyId, createdAt: Date.now(), ...g.record });
  return { ...handles, publicKey: g.publicKey, keyId };
}

describe("gateway", () => {
  test("healthz and readyz respond", async () => {
    const { app } = await setup();
    const h = await app.request("/healthz");
    expect(h.status).toBe(200);
    const r = await app.request("/readyz");
    expect(r.status).toBe(200);
  });

  test("401 without key", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/models");
    expect(res.status).toBe(401);
  });

  test("models list requires scope", async () => {
    const { app, publicKey } = await setup();
    const res = await app.request("/v1/models", { headers: { authorization: `Bearer ${publicKey}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(body.data.length).toBeGreaterThan(0);
  });

  test("chat completion json roundtrip", async () => {
    const { app, publicKey, usage } = await setup();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "Explain Kubernetes" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-infergate-provider")).toBe("openai");
    const body = await res.json();
    expect(body.choices[0].message.content.length).toBeGreaterThan(0);
    expect(body.usage.total_tokens).toBeGreaterThan(0);
    const summary = await usage.usageByOrg("org_test");
    expect(summary.requests).toBe(1);
  });

  test("chat completion rejects unknown model", async () => {
    const { app, publicKey } = await setup();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "nope-9000", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(400);
  });

  test("chat completion rejects invalid body", async () => {
    const { app, publicKey } = await setup();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("sse stream ends with DONE", async () => {
    const { app, publicKey } = await setup();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "stream please" }], stream: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("data: [DONE]");
    expect(text).toContain("chat.completion.chunk");
  });

  test("idempotent replay returns 409", async () => {
    const { app, publicKey } = await setup();
    const payload = { model: "gpt-4o-mini", messages: [{ role: "user", content: "once" }], idempotency_key: "idem-1" };
    const first = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    const second = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(409);
  });

  test("key rotation issues successor and revokes old", async () => {
    const { app, publicKey, keyId } = await setup();
    const res = await app.request(`/v1/keys/${keyId}/rotate`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}` },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.api_key.startsWith("ig_sk_")).toBe(true);
    const retry = await app.request("/v1/models", { headers: { authorization: `Bearer ${publicKey}` } });
    expect(retry.status).toBe(401);
    const next = await app.request("/v1/models", { headers: { authorization: `Bearer ${body.api_key}` } });
    expect(next.status).toBe(200);
  });

  test("usage summary reflects traffic", async () => {
    const { app, publicKey } = await setup();
    await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "llama-3-8b", messages: [{ role: "user", content: "bill me" }] }),
    });
    const res = await app.request("/v1/usage", { headers: { authorization: `Bearer ${publicKey}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toBe(1);
    expect(body.costUsd).toBeGreaterThan(0);
  });
});
