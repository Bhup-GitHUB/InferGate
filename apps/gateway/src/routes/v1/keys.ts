import { Hono } from "hono";
import { generateKey, isValidTier, type StoredKey } from "@infergate/auth";
import { errorBody } from "@infergate/schemas";
import type { GatewayConfig } from "../../lib/config";
import type { AppEnv, AuthContext } from "../../lib/env";
import type { KeyStore } from "../../lib/store";
import type { AuditLog } from "../../lib/audit";
import { requireScope } from "../../middleware/auth";

export interface KeyDeps {
  keys: KeyStore;
  config: GatewayConfig;
  audit: AuditLog;
}

export function keyRoutes(deps: KeyDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/keys", async (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const keys = await deps.keys.listByOrg(auth.orgId).catch(() => null);
    if (!keys) {
      return c.json(errorBody("Keys unavailable", "provider_error", "keys_unavailable"), 503);
    }
    return c.json({
      object: "list",
      data: keys.map((k) => ({
        id: k.id,
        prefix: k.prefix,
        scopes: k.scopes,
        tier: k.tier ?? "standard",
        revoked: k.revokedAt !== null && k.revokedAt <= Date.now(),
        expires_at: k.expiresAt === null ? null : new Date(k.expiresAt).toISOString(),
        last_used_at: k.lastUsedAt === null || k.lastUsedAt === undefined ? null : new Date(k.lastUsedAt).toISOString(),
        created_at: new Date(k.createdAt).toISOString(),
      })),
    });
  });

  app.post("/keys", async (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const callerHas = (scope: string): boolean => auth.scopes.includes("*") || auth.scopes.includes(scope);
    let scopes: string[] = ["chat:write", "models:read", "usage:read"];
    let expiresInDays: number | null = null;
    let tier = "standard";
    try {
      const body = await c.req.json();
      if (Array.isArray((body as { scopes?: unknown }).scopes)) {
        const requested = (body as { scopes: unknown[] }).scopes.filter((s): s is string => typeof s === "string");
        const allowed = new Set(["chat:write", "models:read", "usage:read", "billing:read", "keys:write", "admin:write"]);
        scopes = [...new Set(requested.filter((s) => allowed.has(s)))];
        if (scopes.length === 0) {
          return c.json(errorBody("No valid scopes", "invalid_request_error", "invalid_scopes"), 400);
        }
      }
      const days = (body as { expires_in_days?: unknown }).expires_in_days;
      if (days !== undefined) {
        if (typeof days !== "number" || !Number.isFinite(days) || days < 1 || days > 365) {
          return c.json(errorBody("Invalid expiry", "invalid_request_error", "invalid_expiry"), 400);
        }
        expiresInDays = Math.floor(days);
      }
      const requestedTier = (body as { tier?: unknown }).tier;
      if (requestedTier !== undefined) {
        if (typeof requestedTier !== "string" || !isValidTier(requestedTier)) {
          return c.json(errorBody("Invalid tier", "invalid_request_error", "invalid_tier"), 400);
        }
        if (requestedTier !== "standard" && !callerHas("admin:write")) {
          return c.json(errorBody("Tier requires admin", "authorization_error", "forbidden_tier"), 403);
        }
        tier = requestedTier;
      }
    } catch {
      return c.json(errorBody("Invalid JSON body", "invalid_request_error", "invalid_json"), 400);
    }
    const callerScopes = new Set(auth.scopes);
    const canGrant = (s: string): boolean => callerScopes.has("*") || callerScopes.has(s);
    const granted = scopes.filter(canGrant);
    if (granted.length === 0) {
      return c.json(errorBody("No permitted scopes", "authorization_error", "forbidden_scopes"), 403);
    }
    const generated = generateKey(auth.orgId, granted, deps.config.pepper, deps.config.pepperVersion, tier);
    const record: StoredKey = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      ...generated.record,
      expiresAt: expiresInDays === null ? null : Date.now() + expiresInDays * 86400000,
    };
    await deps.keys.save(record);
    await deps.audit.record(auth.orgId, auth.keyId, "key.create", record.id).catch(() => undefined);
    return c.json({
      id: record.id,
      prefix: record.prefix,
      api_key: generated.publicKey,
      scopes: record.scopes,
      tier: record.tier,
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
    const generated = generateKey(existing.orgId, existing.scopes, deps.config.pepper, deps.config.pepperVersion, existing.tier ?? "standard");
    const successor: StoredKey = {
      id: crypto.randomUUID(),
      createdAt: now,
      ...generated.record,
      rotatedFromId: existing.id,
    };
    await deps.keys.save(successor);
    await deps.keys.scheduleRevoke(existing.id, now + 24 * 60 * 60 * 1000);
    await deps.audit.record(auth.orgId, auth.keyId, "key.rotate", successor.id).catch(() => undefined);
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
    await deps.audit.record(auth.orgId, auth.keyId, "key.revoke", id).catch(() => undefined);
    return c.json({ id, revoked: true });
  });

  app.get("/audit", async (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const rawLimit = Number(c.req.query("limit") ?? "50");
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50, 1), 100);
    const entries = await deps.audit.recent(auth.orgId, limit).catch(() => null);
    if (!entries) {
      return c.json(errorBody("Audit unavailable", "provider_error", "audit_unavailable"), 503);
    }
    return c.json({ object: "list", data: entries });
  });

  return app;
}
