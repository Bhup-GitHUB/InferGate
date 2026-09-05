import { Hono } from "hono";
import { errorBody } from "@infergate/schemas";
import type { RoutingEngine } from "@infergate/routing";
import type { ProviderRegistry } from "@infergate/providers";
import type { AppEnv } from "../../lib/env";
import { requireScope } from "../../middleware/auth";

export function routingRoutes(engine: RoutingEngine, registry: ProviderRegistry): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/routing/health", (c) => {
    if (!requireScope(c, "models:read")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const providers = registry.providers().map((p) => ({
      circuit: engine.circuitState(p.id),
      ...engine.snapshot(p.id),
    }));
    return c.json({ object: "routing_health", providers });
  });

  return app;
}
