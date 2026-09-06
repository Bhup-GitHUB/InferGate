import { Hono } from "hono";
import { z } from "zod";
import { errorBody } from "@infergate/schemas";
import type { RoutingEngine, RoutingStrategy } from "@infergate/routing";
import type { ProviderRegistry } from "@infergate/providers";
import type { AppEnv, AuthContext } from "../../lib/env";
import type { RuleCache } from "../../lib/rules";
import { requireScope } from "../../middleware/auth";

const STRATEGIES: RoutingStrategy[] = ["cost", "latency", "availability", "weighted", "priority"];

const ruleSchema = z.object({
  modelAlias: z.string().min(1).max(128),
  strategy: z.enum(["cost", "latency", "availability", "weighted", "priority"]),
  weights: z.record(z.string(), z.number().min(0)).optional().default({}),
  priority: z.array(z.string().min(1)).max(16).optional().default([]),
  maxAttempts: z.number().int().min(1).max(5).optional().default(3),
});

export interface RoutingDeps {
  engine: RoutingEngine;
  registry: ProviderRegistry;
  rules: RuleCache;
}

export function routingRoutes(deps: RoutingDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/routing/health", (c) => {
    if (!requireScope(c, "models:read")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const providers = deps.registry.providers().map((p) => ({
      circuit: deps.engine.circuitState(p.id),
      kind: p.kind,
      ...deps.engine.snapshot(p.id),
    }));
    return c.json({ object: "routing_health", providers });
  });

  app.get("/routing/rules", async (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const rules = await deps.rules.forOrg(auth.orgId).catch(() => null);
    if (!rules) {
      return c.json(errorBody("Rules unavailable", "provider_error", "rules_unavailable"), 503);
    }
    return c.json({ object: "list", backend: deps.rules.backend, data: rules });
  });

  app.post("/routing/rules", async (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorBody("Invalid JSON body", "invalid_request_error", "invalid_json"), 400);
    }
    const parsed = ruleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(errorBody("Invalid routing rule", "invalid_request_error", "validation_error"), 400);
    }
    if (!STRATEGIES.includes(parsed.data.strategy)) {
      return c.json(errorBody("Unknown strategy", "invalid_request_error", "invalid_strategy"), 400);
    }
    const rule = {
      orgId: auth.orgId,
      modelAlias: parsed.data.modelAlias,
      strategy: parsed.data.strategy,
      weights: parsed.data.weights,
      priority: parsed.data.priority,
      maxAttempts: parsed.data.maxAttempts,
    };
    try {
      await deps.rules.add(auth.orgId, rule);
    } catch {
      return c.json(errorBody("Rules unavailable", "provider_error", "rules_unavailable"), 503);
    }
    return c.json({ created: true, rule }, 201);
  });

  app.delete("/routing/rules/:id", async (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const ok = await deps.rules.remove(auth.orgId, c.req.param("id")).catch(() => false);
    if (!ok) {
      return c.json(errorBody("Rule not found", "invalid_request_error", "rule_not_found"), 404);
    }
    return c.json({ deleted: true });
  });

  return app;
}
