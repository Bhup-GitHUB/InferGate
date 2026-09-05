import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type WebhookEventType = "quota.warning" | "quota.exceeded" | "provider.outage";

export type WebhookEvent = {
  id: string;
  type: WebhookEventType;
  orgId: string;
  data: Record<string, unknown>;
  occurredAt: string;
};

export type WebhookEndpoint = {
  url: string;
  secret: string;
  events: WebhookEventType[];
  orgId: string;
};

export function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function verify(sig: string, payload: string, secret: string): boolean {
  const expected = sign(payload, secret);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildEvent(
  type: WebhookEventType,
  orgId: string,
  data: Record<string, unknown> = {},
): WebhookEvent {
  return {
    id: randomUUID(),
    type,
    orgId,
    data,
    occurredAt: new Date().toISOString(),
  };
}

export function retryDelays(): number[] {
  return [1000, 5000, 30000];
}

export class WebhookQueue {
  private endpoints: WebhookEndpoint[] = [];

  register(url: string, secret: string, events: WebhookEventType[], orgId = "*"): WebhookEndpoint {
    const endpoint: WebhookEndpoint = { url, secret, events: [...events], orgId };
    this.endpoints.push(endpoint);
    return endpoint;
  }

  due(eventType: WebhookEventType): WebhookEndpoint[] {
    return this.endpoints.filter((e) => e.events.includes(eventType));
  }

  dueFor(orgId: string, eventType: WebhookEventType): WebhookEndpoint[] {
    return this.endpoints.filter(
      (e) => (e.orgId === orgId || e.orgId === "*") && e.events.includes(eventType),
    );
  }

  retryDelays(): number[] {
    return retryDelays();
  }
}

export type FetchImpl = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export async function deliver(
  fetchImpl: FetchImpl,
  endpoint: WebhookEndpoint,
  event: WebhookEvent,
  timeoutMs = 5000,
  delays: number[] = retryDelays(),
): Promise<boolean> {
  const payload = JSON.stringify(event);
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-infergate-event": event.type,
          "x-infergate-signature": sign(payload, endpoint.secret),
        },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        return true;
      }
    } catch {
      clearTimeout(timer);
    }
    if (attempt < delays.length) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  return false;
}
