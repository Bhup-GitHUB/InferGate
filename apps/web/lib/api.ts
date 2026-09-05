export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3000";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelEntry {
  id: string;
  object: string;
  owned_by: string;
}

export function getKey(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem("infergate_key") ?? "";
}

export function setKey(key: string): void {
  window.localStorage.setItem("infergate_key", key);
}

export function clearKey(): void {
  window.localStorage.removeItem("infergate_key");
}

async function authed(path: string, key: string, init?: RequestInit): Promise<Response> {
  return fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function listModels(key: string): Promise<ModelEntry[]> {
  const res = await authed("/v1/models", key);
  if (!res.ok) {
    throw new Error(`models ${res.status}`);
  }
  const body = await res.json();
  return body.data as ModelEntry[];
}

export async function fetchUsage(key: string): Promise<{ requests: number; inputTokens: number; outputTokens: number; costUsd: number }> {
  const res = await authed("/v1/usage", key);
  if (!res.ok) {
    throw new Error(`usage ${res.status}`);
  }
  return res.json();
}

export async function fetchDaily(key: string, days: number): Promise<{ days: { date: string; requests: number; inputTokens: number; outputTokens: number; costUsd: number }[] }> {
  const res = await authed(`/v1/usage/daily?days=${days}`, key);
  if (!res.ok) {
    throw new Error(`daily ${res.status}`);
  }
  return res.json();
}

export async function fetchBilling(key: string): Promise<{
  plan: string;
  period: string;
  tokensUsed: number;
  tokenQuota: number;
  spendUsd: number;
  quotaUsd: number;
  invoice: { amountUsd: number; status: string };
}> {
  const res = await authed("/v1/billing/summary", key);
  if (!res.ok) {
    throw new Error(`billing ${res.status}`);
  }
  return res.json();
}

export async function fetchRoutingHealth(key: string): Promise<{
  providers: { id: string; circuit: string; ewmaLatencyMs: number; errorRate: number; costPer1k: number }[];
}> {
  const res = await authed("/v1/routing/health", key);
  if (!res.ok) {
    throw new Error(`routing ${res.status}`);
  }
  return res.json();
}

export async function createKey(key: string, scopes: string[]): Promise<{ id: string; prefix: string; api_key: string; scopes: string[] }> {
  const res = await authed("/v1/keys", key, { method: "POST", body: JSON.stringify({ scopes }) });
  if (!res.ok) {
    throw new Error(`create ${res.status}`);
  }
  return res.json();
}

export async function rotateKey(key: string, id: string): Promise<{ api_key: string }> {
  const res = await authed(`/v1/keys/${id}/rotate`, key, { method: "POST" });
  if (!res.ok) {
    throw new Error(`rotate ${res.status}`);
  }
  return res.json();
}

export async function revokeKey(key: string, id: string): Promise<void> {
  const res = await authed(`/v1/keys/${id}/revoke`, key, { method: "POST" });
  if (!res.ok) {
    throw new Error(`revoke ${res.status}`);
  }
}

export async function fetchRecent(key: string, limit: number): Promise<{
  data: { id: string; model: string; provider: string | null; input_tokens: number; output_tokens: number; latency_ms: number; cost_usd: number; status: string; created_at: string }[];
}> {
  const res = await authed(`/v1/requests?limit=${limit}`, key);
  if (!res.ok) {
    throw new Error(`requests ${res.status}`);
  }
  return res.json();
}

export async function listWebhooks(key: string): Promise<{ data: { id: string; url: string; events: string[] }[] }> {
  const res = await authed("/v1/webhooks", key);
  if (!res.ok) {
    throw new Error(`webhooks ${res.status}`);
  }
  return res.json();
}

export async function addWebhook(key: string, url: string, secret: string, events: string[]): Promise<{ id: string }> {
  const res = await authed("/v1/webhooks", key, { method: "POST", body: JSON.stringify({ url, secret, events }) });
  if (!res.ok) {
    throw new Error(`webhook create ${res.status}`);
  }
  return res.json();
}

export async function removeWebhook(key: string, id: string): Promise<void> {
  const res = await authed(`/v1/webhooks/${id}`, key, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`webhook delete ${res.status}`);
  }
}

export async function fetchPlacementDemo(key: string): Promise<{
  placements: { modelId: string; nodeId: string }[];
  utilization: { nodeId: string; usedMemGb: number; totalMemGb: number }[];
}> {
  const res = await authed("/v1/scheduler/demo", key);
  if (!res.ok) {
    throw new Error(`scheduler ${res.status}`);
  }
  return res.json();
}

export async function streamChat(
  key: string,
  model: string,
  messages: ChatMessage[],
  onToken: (token: string) => void,
  onRoute: (provider: string) => void,
): Promise<void> {
  const res = await authed("/v1/chat/completions", key, {
    method: "POST",
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`chat ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const lines = frame.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data = line.slice(5).trim();
        }
      }
      if (!data || data === "[DONE]") {
        continue;
      }
      try {
        const payload = JSON.parse(data);
        if (event === "infergate.route" && payload.provider) {
          onRoute(payload.provider);
          continue;
        }
        const token = payload.choices?.[0]?.delta?.content as string | undefined;
        if (token) {
          onToken(token);
        }
      } catch {
        continue;
      }
    }
  }
}
