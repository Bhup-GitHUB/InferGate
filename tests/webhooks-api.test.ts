import { describe, expect, test } from "bun:test";
import { generateKey } from "@infergate/auth";
import { buildEvent, deliver, verify } from "@infergate/webhooks";
import { createApp } from "../apps/gateway/src/app";

const PEPPER = "webhook-test-pepper-01";
const SECRET = "0123456789abcdef0123456789abcdef";

async function setup() {
  const handles = createApp({ API_KEY_PEPPER: PEPPER, PEPPER_VERSION: "1", RATE_LIMIT_PER_MINUTE: "1000" });
  const g = generateKey("org_hook", ["chat:write", "models:read", "keys:write"], PEPPER, 1);
  await handles.keys.save({ id: crypto.randomUUID(), createdAt: Date.now(), ...g.record });
  return { ...handles, publicKey: g.publicKey };
}

describe("webhooks", () => {
  test("crud roundtrip hides secrets", async () => {
    const { app, publicKey } = await setup();
    const headers = { authorization: `Bearer ${publicKey}`, "content-type": "application/json" };
    const created = await app.request("/v1/webhooks", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://example.com/hook", secret: SECRET, events: ["provider.outage"] }),
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.id).toBeString();
    const listed = await app.request("/v1/webhooks", { headers: { authorization: `Bearer ${publicKey}` } });
    const lbody = await listed.json();
    expect(lbody.data.length).toBe(1);
    expect(JSON.stringify(lbody)).not.toContain(SECRET);
    const bad = await app.request("/v1/webhooks", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "not-a-url", secret: "short", events: ["nope"] }),
    });
    expect(bad.status).toBe(400);
    const deleted = await app.request(`/v1/webhooks/${body.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${publicKey}` },
    });
    expect(deleted.status).toBe(200);
  });

  test("deliveries feed is scoped", async () => {
    const { app, publicKey } = await setup();
    const res = await app.request("/v1/webhooks/deliveries", { headers: { authorization: `Bearer ${publicKey}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  test("delivery is hmac signed with retries", async () => {
    const seen: { headers: Record<string, string>; body: string }[] = [];
    const event = buildEvent("provider.outage", "org_hook", { provider: "openai" });
    const ok = await deliver(
      async (_url, init) => {
        seen.push({ headers: init.headers, body: init.body });
        return { ok: true, status: 200 };
      },
      { url: "https://example.com/hook", secret: SECRET, events: ["provider.outage"], orgId: "org_hook" },
      event,
    );
    expect(ok).toBe(true);
    expect(seen.length).toBe(1);
    expect(seen[0].headers["x-infergate-event"]).toBe("provider.outage");
    expect(verify(seen[0].headers["x-infergate-signature"], seen[0].body, SECRET)).toBe(true);
  });

  test("delivery retries then reports failure", async () => {
    let calls = 0;
    const event = buildEvent("quota.exceeded", "org_hook", {});
    const ok = await deliver(
      async () => {
        calls += 1;
        return { ok: false, status: 500 };
      },
      { url: "https://example.com/hook", secret: SECRET, events: ["quota.exceeded"], orgId: "org_hook" },
      event,
      50,
      [1, 1, 1],
    );
    expect(ok).toBe(false);
    expect(calls).toBe(4);
  });
});
