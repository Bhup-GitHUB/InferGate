import { Redis } from "ioredis";

let shared: Redis | null = null;

export function getRedis(url: string | undefined): Redis | null {
  if (!url) {
    return null;
  }
  if (!shared) {
    shared = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }
  return shared;
}

export async function ping(client: Redis | null): Promise<boolean> {
  if (!client) {
    return false;
  }
  try {
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

export function resetClient(): void {
  if (shared) {
    shared.disconnect();
    shared = null;
  }
}
