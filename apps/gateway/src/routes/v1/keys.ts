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

  app.post("/keys", async (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    let scopes: string[] = ["chat:write", "models:read", "usage:read"];
    try {
      const body = await c.req.json();
      if (Array.isArray((body as { scopes?: unknown }).scopes)) {
        const requested = (body as { scopes: unknown[] }).scopes.filter((s): s is string => typeof s === "string");
        const allowed = new Set(["chat:write", "models:read", "usage:read", "billing:read", "keys:write"]);
        scopes = [...new Set(requested.filter((s) => allowed.has(s)))];
        if (scopes.length === 0) {
          return c.json(errorBody("No valid scopes", "invalid_request_error", "invalid_scopes"), 400);
        }
      }
    } catch {
      return c.json(errorBody("Invalid JSON body", "invalid_request_error", "invalid_json"), 400);
    }
    const generated = generateKey(auth.orgId, scopes, deps.config.pepper, deps.config.pepperVersion);
    const record: StoredKey = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      ...generated.record,
    };
    await deps.keys.save(record);
    return c.json({
      id: record.id,
      prefix: record.prefix,
      api_key: generated.publicKey,
      scopes: record.scopes,
      org_id: auth.orgId,
    }, 201);
  });

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
    await deps.keys.scheduleRevoke(existing.id, now + 24 * 60 * 60 * 1000);
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
