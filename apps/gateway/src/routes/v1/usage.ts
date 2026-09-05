import { Hono } from "hono";
import { errorBody } from "@infergate/schemas";
import type { UsageStore } from "../../lib/store";
import type { AppEnv, AuthContext } from "../../lib/env";
import { requireScope } from "../../middleware/auth";

export function usageRoutes(usage: UsageStore): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/usage", async (c) => {
    if (!requireScope(c, "usage:read")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const summary = await usage.usageByOrg(auth.orgId).catch(() => null);
    if (!summary) {
      return c.json(errorBody("Usage unavailable", "provider_error", "usage_unavailable"), 503);
    }
    return c.json({ object: "usage_summary", org_id: auth.orgId, ...summary });
  });

  app.get("/requests", async (c) => {
    if (!requireScope(c, "usage:read")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "25"), 1), 100);
    const rows = await usage.recent(auth.orgId, limit).catch(() => null);
    if (!rows) {
      return c.json(errorBody("Usage unavailable", "provider_error", "usage_unavailable"), 503);
    }
    return c.json({
      object: "list",
      data: rows.map((r) => ({
        id: r.id,
        model: r.model,
        provider: r.providerId,
        input_tokens: r.inputTokens,
        output_tokens: r.outputTokens,
        latency_ms: r.latencyMs,
        cost_usd: r.costUsd,
        status: r.status,
        created_at: new Date(r.createdAt).toISOString(),
      })),
    });
  });

  return app;
}
