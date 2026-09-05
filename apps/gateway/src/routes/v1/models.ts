import { Hono } from "hono";
import { errorBody } from "@infergate/schemas";
import type { ProviderRegistry } from "@infergate/providers";
import type { AppEnv } from "../../lib/env";
import { requireScope } from "../../middleware/auth";

export function modelRoutes(registry: ProviderRegistry): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/models", (c) => {
    if (!requireScope(c, "models:read")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const data = registry.listModels().map((m) => ({ id: m.id, object: "model" as const, owned_by: m.ownedBy }));
    return c.json({ object: "list" as const, data });
  });

  return app;
}
