import { Hono } from "hono";
import { generateKey, type StoredKey } from "@infergate/auth";
import { errorBody } from "@infergate/schemas";
import type { GatewayConfig } from "../../lib/config";
import type { AppEnv, AuthContext } from "../../lib/env";
import type { KeyStore } from "../../lib/store";
import { requireScope } from "../../middleware/auth";

export interface KeyDeps {
  keys: KeyStore;
  config: GatewayConfig;
}

export function keyRoutes(deps: KeyDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/keys/:id/rotate", async (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const id = c.req.param("id");
    const existing = await deps.keys.findById(id).catch(() => null);
    if (!existing || existing.orgId !== auth.orgId) {
      return c.json(errorBody("Key not found", "invalid_request_error", "key_not_found"), 404);
    }
    const now = Date.now();
    const generated = generateKey(existing.orgId, existing.scopes, deps.config.pepper, deps.config.pepperVersion);
    const successor: StoredKey = {
      id: crypto.randomUUID(),
      createdAt: now,
      ...generated.record,
      rotatedFromId: existing.id,
    };
    await deps.keys.save(successor);
    await deps.keys.revoke(existing.id, now);
    return c.json({
      id: successor.id,
      prefix: successor.prefix,
      api_key: generated.publicKey,
      scopes: successor.scopes,
      rotated_from: existing.id,
      grace_ms: 24 * 60 * 60 * 1000,
    }, 201);
  });

  app.post("/keys/:id/revoke", async (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const id = c.req.param("id");
    const existing = await deps.keys.findById(id).catch(() => null);
    if (!existing || existing.orgId !== auth.orgId) {
      return c.json(errorBody("Key not found", "invalid_request_error", "key_not_found"), 404);
    }
    await deps.keys.revoke(id, Date.now());
    return c.json({ id, revoked: true });
  });

  return app;
}
