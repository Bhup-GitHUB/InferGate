import { Hono } from "hono";
import { errorBody } from "@infergate/schemas";
import type { ProviderRegistry } from "@infergate/providers";
import type { AppEnv, AuthContext } from "../../lib/env";
import type { AuditLog } from "../../lib/audit";
import { requireScope } from "../../middleware/auth";

export interface ModelDeps {
  registry: ProviderRegistry;
  audit: AuditLog;
}

export function modelRoutes(deps: ModelDeps): Hono<AppEnv> {
  const { registry } = deps;
  const app = new Hono<AppEnv>();

  app.get("/models", (c) => {
    if (!requireScope(c, "models:read")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const data = registry.listModels().map((m) => ({ id: m.id, object: "model" as const, owned_by: m.ownedBy }));
    return c.json({ object: "list" as const, data });
  });

  app.get("/models/:id", (c) => {
    if (!requireScope(c, "models:read")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const model = registry.resolveModel(c.req.param("id"));
    if (!model) {
      return c.json(errorBody("Model not found", "invalid_request_error", "model_not_found"), 404);
    }
    return c.json({
      id: model.id,
      object: "model" as const,
      owned_by: model.ownedBy,
      provider: model.providerId,
      pricing: { input_per_1k: model.inputPricePer1k, output_per_1k: model.outputPricePer1k },
      context_window: model.contextWindow,
    });
  });

  app.post("/models/:id/disable", async (c) => {
    if (!requireScope(c, "admin:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const ok = registry.setModelEnabled(c.req.param("id"), false);
    if (!ok) {
      return c.json(errorBody("Model not found", "invalid_request_error", "model_not_found"), 404);
    }
    await deps.audit.record(auth.orgId, auth.keyId, "model.disable", c.req.param("id")).catch(() => undefined);
    return c.json({ id: c.req.param("id"), enabled: false });
  });

  app.post("/models/:id/enable", async (c) => {
    if (!requireScope(c, "admin:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const ok = registry.setModelEnabled(c.req.param("id"), true);
    if (!ok) {
      return c.json(errorBody("Model not found", "invalid_request_error", "model_not_found"), 404);
    }
    await deps.audit.record(auth.orgId, auth.keyId, "model.enable", c.req.param("id")).catch(() => undefined);
    return c.json({ id: c.req.param("id"), enabled: true });
  });

  return app;
}
