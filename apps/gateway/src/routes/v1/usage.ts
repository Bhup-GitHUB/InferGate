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

  return app;
}
