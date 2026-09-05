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

  register(url: string, secret: string, events: WebhookEventType[]): WebhookEndpoint {
    const endpoint: WebhookEndpoint = { url, secret, events: [...events] };
    this.endpoints.push(endpoint);
    return endpoint;
  }

  due(eventType: WebhookEventType): WebhookEndpoint[] {
    return this.endpoints.filter((e) => e.events.includes(eventType));
  }

  retryDelays(): number[] {
    return retryDelays();
  }
}
