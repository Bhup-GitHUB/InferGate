import type { Redis } from "ioredis";
import type { StoredKey } from "@infergate/auth";
import type { KeyStore } from "./store";

const TTL_SECONDS = 30;

function cacheKey(prefix: string): string {
  return `key:prefix:${prefix}`;
}

export class CachedKeyStore implements KeyStore {
  private inner: KeyStore;
  private redis: Redis | null;
  private local = new Map<string, { key: StoredKey; at: number }>();
  private touched = new Map<string, number>();

  constructor(inner: KeyStore, redis: Redis | null) {
    this.inner = inner;
    this.redis = redis;
  }

  private readLocal(prefix: string): StoredKey | null {
    const hit = this.local.get(prefix);
    if (hit && Date.now() - hit.at < TTL_SECONDS * 1000) {
      return hit.key;
    }
    this.local.delete(prefix);
    return null;
  }

  async findByPrefix(prefix: string): Promise<StoredKey | null> {
    const local = this.readLocal(prefix);
    if (local) {
      return local;
    }
    if (this.redis) {
      try {
        const raw = await this.redis.get(cacheKey(prefix));
        if (raw) {
          const key = JSON.parse(raw) as StoredKey;
          this.local.set(prefix, { key, at: Date.now() });
          return key;
        }
      } catch {
        return this.inner.findByPrefix(prefix);
      }
    }
    const key = await this.inner.findByPrefix(prefix);
    if (key) {
      this.local.set(prefix, { key, at: Date.now() });
      if (this.redis) {
        await this.redis.set(cacheKey(prefix), JSON.stringify(key), "EX", TTL_SECONDS).catch(() => undefined);
      }
    }
    if (this.local.size > 5000) {
      const first = this.local.keys().next().value;
      if (first) {
        this.local.delete(first);
      }
    }
    return key;
  }

  async findById(id: string): Promise<StoredKey | null> {
    return this.inner.findById(id);
  }

  async listByOrg(orgId: string): Promise<StoredKey[]> {
    return this.inner.listByOrg(orgId);
  }

  async save(key: StoredKey): Promise<void> {
    await this.inner.save(key);
    await this.invalidate(key.prefix);
  }

  async revoke(id: string, now: number): Promise<void> {
    const existing = await this.inner.findById(id);
    await this.inner.revoke(id, now);
    if (existing) {
      await this.invalidate(existing.prefix);
    }
  }

  async scheduleRevoke(id: string, at: number): Promise<void> {
    const existing = await this.inner.findById(id);
    await this.inner.scheduleRevoke(id, at);
    if (existing && at <= Date.now()) {
      await this.invalidate(existing.prefix);
    }
  }

  async touch(id: string, now: number): Promise<void> {
    const last = this.touched.get(id) ?? 0;
    if (now - last < 60000) {
      return;
    }
    this.touched.set(id, now);
    await this.inner.touch(id, now).catch(() => undefined);
  }

  async invalidate(prefix: string): Promise<void> {
    this.local.delete(prefix);
    if (this.redis) {
      await this.redis.del(cacheKey(prefix)).catch(() => undefined);
    }
  }
}
