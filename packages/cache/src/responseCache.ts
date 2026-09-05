import { createHash } from "node:crypto";
import type { Redis } from "ioredis";

export interface CachedCompletion {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  providerId: string;
  modelId: string;
}

export function cacheKey(orgId: string, model: string, messages: unknown, maxTokens: unknown, temperature: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ model, messages, maxTokens, temperature }))
    .digest("hex");
  return `cache:completion:${orgId}:${digest}`;
}

export async function cacheGet(client: Redis | null, key: string): Promise<CachedCompletion | null> {
  if (!client) {
    return null;
  }
  try {
    const raw = await client.get(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as CachedCompletion;
  } catch {
    return null;
  }
}

export async function cacheSet(client: Redis | null, key: string, value: CachedCompletion, ttlSeconds: number): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.set(key, JSON.stringify(value), "EX", Math.min(Math.max(ttlSeconds, 1), 3600));
  } catch {
    return;
  }
}
