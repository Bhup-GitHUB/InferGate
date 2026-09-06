import { describe, expect, test } from "bun:test";
import { generateKey } from "@infergate/auth";
import { MemoryKeyStore } from "../apps/gateway/src/lib/store";
import { CachedKeyStore } from "../apps/gateway/src/lib/keycache";

const PEPPER = "keycache-test-pepper-01";

describe("keycache", () => {
  test("caches lookups and invalidates on revoke", async () => {
    const inner = new MemoryKeyStore();
    const cached = new CachedKeyStore(inner, null);
    const g = generateKey("org_cache", ["chat:write"], PEPPER, 1);
    const id = crypto.randomUUID();
    await cached.save({ id, createdAt: Date.now(), ...g.record });
    const first = await cached.findByPrefix(g.prefix);
    expect(first?.id).toBe(id);
    await inner.save({ ...(first as NonNullable<typeof first>), scopes: ["other"] });
    const stale = await cached.findByPrefix(g.prefix);
    expect(stale?.scopes).toEqual(["chat:write"]);
    await cached.revoke(id, Date.now());
    const after = await cached.findByPrefix(g.prefix);
    expect(after?.revokedAt).not.toBeNull();
  });

  test("grace revocation stays cached and active", async () => {
    const inner = new MemoryKeyStore();
    const cached = new CachedKeyStore(inner, null);
    const g = generateKey("org_grace", ["chat:write"], PEPPER, 1);
    const id = crypto.randomUUID();
    await cached.save({ id, createdAt: Date.now(), ...g.record });
    await cached.scheduleRevoke(id, Date.now() + 3600000);
    const kept = await cached.findByPrefix(g.prefix);
    expect(kept?.id).toBe(id);
  });
});
