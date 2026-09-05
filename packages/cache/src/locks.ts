import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";

export interface LockHandle {
  key: string;
  token: string;
}

export async function acquireLock(client: Redis | null, key: string, ttlMs: number): Promise<LockHandle | null> {
  if (!client) {
    return { key, token: "local" };
  }
  const token = randomBytes(12).toString("hex");
  try {
    const res = await client.set(key, token, "PX", ttlMs, "NX");
    if (res !== "OK") {
      return null;
    }
    return { key, token };
  } catch {
    return null;
  }
}

const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export async function releaseLock(client: Redis | null, handle: LockHandle): Promise<void> {
  if (!client || handle.token === "local") {
    return;
  }
  try {
    await client.eval(RELEASE_LUA, 1, handle.key, handle.token);
  } catch {
    return;
  }
}
