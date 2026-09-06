import { describe, expect, test } from "bun:test";
import { generateKey } from "@infergate/auth";
import { createApp } from "../apps/gateway/src/app";

const PEPPER = "integration-pepper";

async function setup() {
  const handles = createApp({ API_KEY_PEPPER: PEPPER, PEPPER_VERSION: "1", RATE_LIMIT_PER_MINUTE: "1000" });
  const g = generateKey("org_test", ["chat:write", "models:read", "usage:read", "billing:read", "keys:write"], PEPPER, 1);
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

  test("embeddings return deterministic vectors", async () => {
    const { app, publicKey } = await setup();
    const headers = { authorization: `Bearer ${publicKey}`, "content-type": "application/json" };
    const first = await app.request("/v1/embeddings", {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "text-embedding-3-small", input: "hello world" }),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("server-timing")).toContain("gateway");
    const a = await first.json();
    expect(a.data[0].embedding.length).toBe(64);
    const second = await app.request("/v1/embeddings", {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "text-embedding-3-small", input: "hello world" }),
    });
    const b = await second.json();
    expect(b.data[0].embedding).toEqual(a.data[0].embedding);
  });

  test("auto resolves to serving provider model", async () => {
    const { app, publicKey } = await setup();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "which model" }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const provider = res.headers.get("x-infergate-provider") as string;
    const expected = { openai: "gpt-4o-mini", anthropic: "claude-3-5-sonnet", "local-vllm": "llama-3-8b" }[provider];
    expect(body.model).toBe(expected);
  });

  test("cache_ttl returns HIT on repeat", async () => {
    const { app, publicKey } = await setup();
    const payload = { model: "gpt-4o-mini", messages: [{ role: "user", content: "cache me" }], cache_ttl: 60 };
    const headers = { authorization: `Bearer ${publicKey}`, "content-type": "application/json" };
    const first = await app.request("/v1/chat/completions", { method: "POST", headers, body: JSON.stringify(payload) });
    expect(first.status).toBe(200);
    expect(first.headers.get("x-infergate-cache")).toBe("MISS");
    const second = await app.request("/v1/chat/completions", { method: "POST", headers, body: JSON.stringify(payload) });
    expect(second.status).toBe(200);
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

  test("key rotation issues successor and keeps grace", async () => {
    const { app, publicKey, keyId } = await setup();
    const res = await app.request(`/v1/keys/${keyId}/rotate`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}` },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.api_key.startsWith("ig_sk_")).toBe(true);
    expect(body.grace_ms).toBe(24 * 60 * 60 * 1000);
    const grace = await app.request("/v1/models", { headers: { authorization: `Bearer ${publicKey}` } });
    expect(grace.status).toBe(200);
    const next = await app.request("/v1/models", { headers: { authorization: `Bearer ${body.api_key}` } });
    expect(next.status).toBe(200);
  });

  test("key creation returns one-time secret", async () => {
    const { app, publicKey } = await setup();
    const res = await app.request("/v1/keys", {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ scopes: ["models:read"] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.api_key.startsWith("ig_sk_")).toBe(true);
    const check = await app.request("/v1/models", { headers: { authorization: `Bearer ${body.api_key}` } });
    expect(check.status).toBe(200);
  });

  test("key creation cannot escalate scopes", async () => {
    const handles = createApp({ API_KEY_PEPPER: PEPPER, PEPPER_VERSION: "1", RATE_LIMIT_PER_MINUTE: "1000" });
    const g = generateKey("org_narrow", ["keys:write", "models:read"], PEPPER, 1);
    await handles.keys.save({ id: crypto.randomUUID(), createdAt: Date.now(), ...g.record });
    const res = await handles.app.request("/v1/keys", {
      method: "POST",
      headers: { authorization: `Bearer ${g.publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ scopes: ["billing:read", "chat:write"] }),
    });
    expect(res.status).toBe(403);
  });
  test("revoked key is rejected", async () => {
    const { app, publicKey, keyId, keys } = await setup();
    await keys.revoke(keyId, Date.now());
    const res = await app.request("/v1/models", { headers: { authorization: `Bearer ${publicKey}` } });
    expect(res.status).toBe(401);
  });

  test("missing scope returns 403", async () => {
    const handles = createApp({ API_KEY_PEPPER: PEPPER, PEPPER_VERSION: "1", RATE_LIMIT_PER_MINUTE: "1000" });
    const g = generateKey("org_narrow", ["models:read"], PEPPER, 1);
    await handles.keys.save({ id: crypto.randomUUID(), createdAt: Date.now(), ...g.record });
    const res = await handles.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${g.publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(403);
  });

  test("rate limit returns 429", async () => {
    const handles = createApp({ API_KEY_PEPPER: PEPPER, PEPPER_VERSION: "1", RATE_LIMIT_PER_MINUTE: "2" });
    const g = generateKey("org_rl", ["models:read"], PEPPER, 1);
    await handles.keys.save({ id: crypto.randomUUID(), createdAt: Date.now(), ...g.record });
    const headers = { authorization: `Bearer ${g.publicKey}` };
    expect((await handles.app.request("/v1/models", { headers })).status).toBe(200);
    expect((await handles.app.request("/v1/models", { headers })).status).toBe(200);
    const limited = await handles.app.request("/v1/models", { headers });
    expect(limited.status).toBe(429);
  });

  test("idempotency keys are isolated per org", async () => {
    const { app, publicKey, keys } = await setup();
    const other = generateKey("org_other", ["chat:write"], PEPPER, 1);
    await keys.save({ id: crypto.randomUUID(), createdAt: Date.now(), ...other.record });
    const payload = { model: "gpt-4o-mini", messages: [{ role: "user", content: "shared key" }], idempotency_key: "shared-1" };
    const first = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    const cross = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${other.publicKey}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(cross.status).toBe(200);
  });

  test("routing health reports circuits", async () => {
    const { app, publicKey } = await setup();
    const res = await app.request("/v1/routing/health", { headers: { authorization: `Bearer ${publicKey}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers.length).toBe(3);
  });

  test("failed provider is routed around", async () => {
    const { app, publicKey, routing } = await setup();
    routing.reportFailure("openai");
    routing.reportFailure("openai");
    routing.reportFailure("openai");
    routing.reportFailure("openai");
    routing.reportFailure("openai");
    expect(routing.circuitState("openai")).toBe("open");
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "route around" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-infergate-provider")).not.toBe("openai");
  });
  test("webhook url ssrf is rejected", async () => {
    const { app, publicKey } = await setup();
    const headers = { authorization: `Bearer ${publicKey}`, "content-type": "application/json" };
    for (const url of ["http://169.254.169.254/hook", "https://user:pw@example.com/hook", "http://example.com/hook"]) {
      const res = await app.request("/v1/webhooks", {
        method: "POST",
        headers,
        body: JSON.stringify({ url, secret: "0123456789abcdef", events: ["provider.outage"] }),
      });
      expect(res.status).toBe(400);
    }
    const prevEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    const privateRes = await app.request("/v1/webhooks", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://10.1.2.3/hook", secret: "0123456789abcdef", events: ["provider.outage"] }),
    });
    expect(privateRes.status).toBe(400);
    if (prevEnv === undefined) {
      delete process.env["NODE_ENV"];
    } else {
      process.env["NODE_ENV"] = prevEnv;
    }
    const local = await app.request("/v1/webhooks", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "http://localhost:9000/hook", secret: "0123456789abcdef", events: ["provider.outage"] }),
    });
    expect(local.status).toBe(201);
  });

  test("recent requests feed lists traffic", async () => {
    const { app, publicKey } = await setup();
    await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "feed me" }] }),
    });
    const res = await app.request("/v1/requests?limit=10", { headers: { authorization: `Bearer ${publicKey}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].model).toBe("gpt-4o-mini");
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
