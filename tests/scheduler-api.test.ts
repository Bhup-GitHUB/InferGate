import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { schedulerRoutes } from "../apps/gateway/src/routes/v1/scheduler";
import type { AppEnv } from "../apps/gateway/src/lib/env";

function buildApp(scopes: string[] | null) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    if (scopes !== null) {
      c.set("auth", { keyId: "key-test", orgId: "org-test", scopes });
    }
    await next();
  });
  app.route("/", schedulerRoutes());
  return app;
}

const payload = {
  nodes: [
    { id: "node-a100", gpus: [{ type: "A100", count: 4, memGb: 40 }] },
    { id: "node-h100", gpus: [{ type: "H100", count: 8, memGb: 80 }] },
  ],
  models: [
    { id: "model-a", memGb: 20, replicas: 2 },
    { id: "model-b", memGb: 70, replicas: 1 },
  ],
};

describe("scheduler api", () => {
  test("placement returns 200 with placement shape", async () => {
    const app = buildApp(["models:read"]);
    const res = await app.request("/scheduler/placement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.placements)).toBe(true);
    expect(body.placements.length).toBe(3);
    for (const p of body.placements) {
      expect(typeof p.modelId).toBe("string");
      expect(typeof p.nodeId).toBe("string");
    }
    expect(Array.isArray(body.utilization)).toBe(true);
    expect(body.utilization.length).toBe(2);
    for (const u of body.utilization) {
      expect(typeof u.nodeId).toBe("string");
      expect(typeof u.usedMemGb).toBe("number");
      expect(typeof u.totalMemGb).toBe("number");
    }
    const totals = Object.fromEntries(body.utilization.map((u: { nodeId: string; totalMemGb: number }) => [u.nodeId, u.totalMemGb]));
    expect(totals["node-a100"]).toBe(160);
    expect(totals["node-h100"]).toBe(640);
  });

  test("placement returns 403 without scope", async () => {
    const app = buildApp([]);
    const res = await app.request("/scheduler/placement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(403);
  });

  test("placement returns 403 with no auth context", async () => {
    const app = buildApp(null);
    const res = await app.request("/scheduler/placement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(403);
  });

  test("placement returns 400 for invalid body", async () => {
    const app = buildApp(["models:read"]);
    const res = await app.request("/scheduler/placement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodes: [], models: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("demo returns canned two-node placement", async () => {
    const app = buildApp(["models:read"]);
    const res = await app.request("/scheduler/demo");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placements.length).toBe(4);
    expect(body.placements.filter((p: { modelId: string }) => p.modelId === "model-a").length).toBe(2);
    expect(body.utilization.length).toBe(2);
    const used = Object.fromEntries(
      body.utilization.map((u: { nodeId: string; usedMemGb: number }) => [u.nodeId, u.usedMemGb]),
    );
    expect(used["node-a100"]).toBe(0);
    expect(used["node-h100"]).toBe(310);
  });
});
