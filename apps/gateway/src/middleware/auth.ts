import type { Context, Next } from "hono";
import { isKeyActive, parseKey, verifyWithPepperRotation, type StoredKey } from "@infergate/auth";
import { errorBody } from "@infergate/schemas";
import type { AppEnv, AuthContext } from "../lib/env";
import type { KeyStore } from "../lib/store";

export type { AuthContext };

export function authMiddleware(keys: KeyStore, peppers: Map<number, string>) {
  return async (c: Context<AppEnv>, next: Next) => {
    const header = c.req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/);
    if (!match) {
      return c.json(errorBody("Missing bearer token", "authentication_error", "missing_api_key"), 401);
    }
    const parsed = parseKey(match[1]);
    if (!parsed) {
      return c.json(errorBody("Malformed API key", "authentication_error", "invalid_api_key"), 401);
    }
    let stored: StoredKey | null = null;
    try {
      stored = await keys.findByPrefix(parsed.prefix);
    } catch {
      return c.json(errorBody("Authentication service unavailable", "provider_error", "auth_unavailable"), 503);
    }
    if (!stored) {
      return c.json(errorBody("Invalid API key", "authentication_error", "invalid_api_key"), 401);
    }
    const pepper = peppers.get(stored.pepperVersion) ?? peppers.values().next().value;
    if (!pepper || !verifyWithPepperRotation(parsed.secret, stored, peppers)) {
      return c.json(errorBody("Invalid API key", "authentication_error", "invalid_api_key"), 401);
    }
    if (!isKeyActive(stored, Date.now())) {
      return c.json(errorBody("API key expired or revoked", "authentication_error", "key_inactive"), 401);
    }
    c.set("auth", { keyId: stored.id, orgId: stored.orgId, scopes: stored.scopes, tier: stored.tier ?? "standard" });
    await next();
  };
}

export function requireScope(c: Context<AppEnv>, scope: string): boolean {
  const auth = c.get("auth") as AuthContext | undefined;
  if (!auth) {
    return false;
  }
  return auth.scopes.includes(scope) || auth.scopes.includes("*");
}
