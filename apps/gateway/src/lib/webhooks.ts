import { buildEvent, deliver, type FetchImpl, type WebhookEndpoint, type WebhookEventType } from "@infergate/webhooks";
import type { PgWebhookStore } from "@infergate/db";
import { structuredLog } from "@infergate/otel";

export interface StoredEndpoint extends WebhookEndpoint {
  id: string;
}

export interface WebhookEndpoints {
  add(orgId: string, url: string, secret: string, events: WebhookEventType[]): Promise<StoredEndpoint>;
  list(orgId: string): Promise<Array<{ id: string; url: string; events: WebhookEventType[] }>>;
  remove(orgId: string, id: string): Promise<boolean>;
  forEvent(orgId: string, type: WebhookEventType): Promise<StoredEndpoint[]>;
}

export class WebhookStore implements WebhookEndpoints {
  private endpoints = new Map<string, StoredEndpoint>();

  async add(orgId: string, url: string, secret: string, events: WebhookEventType[]): Promise<StoredEndpoint> {
    const endpoint: StoredEndpoint = { id: crypto.randomUUID(), orgId, url, secret, events: [...events] };
    this.endpoints.set(endpoint.id, endpoint);
    return endpoint;
  }

  async list(orgId: string): Promise<Array<{ id: string; url: string; events: WebhookEventType[] }>> {
    return [...this.endpoints.values()]
      .filter((e) => e.orgId === orgId)
      .map((e) => ({ id: e.id, url: e.url, events: e.events }));
  }

  async remove(orgId: string, id: string): Promise<boolean> {
    const existing = this.endpoints.get(id);
    if (!existing || existing.orgId !== orgId) {
      return false;
    }
    this.endpoints.delete(id);
    return true;
  }

  async forEvent(orgId: string, type: WebhookEventType): Promise<StoredEndpoint[]> {
    return [...this.endpoints.values()].filter((e) => e.orgId === orgId && e.events.includes(type));
  }
}

export class PgWebhooks implements WebhookEndpoints {
  constructor(private pg: PgWebhookStore) {}

  async add(orgId: string, url: string, secret: string, events: WebhookEventType[]): Promise<StoredEndpoint> {
    const row = await this.pg.add(orgId, url, secret, events);
    return { id: row.id, orgId: row.orgId, url: row.url, secret: row.secret, events: row.events as WebhookEventType[] };
  }

  async list(orgId: string): Promise<Array<{ id: string; url: string; events: WebhookEventType[] }>> {
    const rows = await this.pg.list(orgId);
    return rows.map((r) => ({ id: r.id, url: r.url, events: r.events as WebhookEventType[] }));
  }

  async remove(orgId: string, id: string): Promise<boolean> {
    return this.pg.remove(orgId, id);
  }

  async forEvent(orgId: string, type: WebhookEventType): Promise<StoredEndpoint[]> {
    const rows = await this.pg.list(orgId);
    return rows
      .filter((r) => r.events.includes(type))
      .map((r) => ({ id: r.id, orgId: r.orgId, url: r.url, secret: r.secret, events: r.events as WebhookEventType[] }));
  }
}

export interface DeliveryRecord {
  at: string;
  orgId: string;
  type: WebhookEventType;
  url: string;
  ok: boolean;
}

export class Notifier {  private fetchImpl: FetchImpl;
  private log: DeliveryRecord[] = [];

  constructor(fetchImpl?: FetchImpl) {
    this.fetchImpl =
      fetchImpl ??
      (async (url, init) => {
        const res = await fetch(url, init);
        return { ok: res.ok, status: res.status };
      });
  }

  emit(store: WebhookEndpoints, orgId: string, type: WebhookEventType, data: Record<string, unknown>): void {
    const event = buildEvent(type, orgId, data);
    store
      .forEvent(orgId, type)
      .then((endpoints) => {
        for (const endpoint of endpoints) {
          deliver(this.fetchImpl, endpoint, event)
            .then((ok) => {
              this.log.unshift({ at: new Date().toISOString(), orgId, type, url: endpoint.url, ok });
              this.log = this.log.slice(0, 50);
              console.log(structuredLog({ level: ok ? "info" : "error", msg: "webhook_delivery", type, orgId, ok }));
            })
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }

  deliveries(orgId: string): DeliveryRecord[] {
    return this.log.filter((d) => d.orgId === orgId);
  }
}
