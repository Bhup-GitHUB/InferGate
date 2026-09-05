import { buildEvent, deliver, type FetchImpl, type WebhookEndpoint, type WebhookEventType } from "@infergate/webhooks";
import { structuredLog } from "@infergate/otel";

export interface StoredEndpoint extends WebhookEndpoint {
  id: string;
}

export class WebhookStore {
  private endpoints = new Map<string, StoredEndpoint>();

  add(orgId: string, url: string, secret: string, events: WebhookEventType[]): StoredEndpoint {
    const endpoint: StoredEndpoint = { id: crypto.randomUUID(), orgId, url, secret, events: [...events] };
    this.endpoints.set(endpoint.id, endpoint);
    return endpoint;
  }

  list(orgId: string): Array<{ id: string; url: string; events: WebhookEventType[] }> {
    return [...this.endpoints.values()]
      .filter((e) => e.orgId === orgId)
      .map((e) => ({ id: e.id, url: e.url, events: e.events }));
  }

  remove(orgId: string, id: string): boolean {
    const existing = this.endpoints.get(id);
    if (!existing || existing.orgId !== orgId) {
      return false;
    }
    this.endpoints.delete(id);
    return true;
  }

  forEvent(orgId: string, type: WebhookEventType): StoredEndpoint[] {
    return [...this.endpoints.values()].filter((e) => e.orgId === orgId && e.events.includes(type));
  }
}

export class Notifier {
  private fetchImpl: FetchImpl;

  constructor(fetchImpl?: FetchImpl) {
    this.fetchImpl =
      fetchImpl ??
      (async (url, init) => {
        const res = await fetch(url, init);
        return { ok: res.ok, status: res.status };
      });
  }

  emit(store: WebhookStore, orgId: string, type: WebhookEventType, data: Record<string, unknown>): void {
    const event = buildEvent(type, orgId, data);
    for (const endpoint of store.forEvent(orgId, type)) {
      deliver(this.fetchImpl, endpoint, event)
        .then((ok) => {
          console.log(structuredLog({ level: ok ? "info" : "error", msg: "webhook_delivery", type, orgId, ok }));
        })
        .catch(() => undefined);
    }
  }
}
