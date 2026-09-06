import { Hono } from "hono";
import { z } from "zod";
import type { WebhookEventType } from "@infergate/webhooks";
import { assertWebhookUrl } from "@infergate/providers";
import { errorBody } from "@infergate/schemas";
import type { AppEnv, AuthContext } from "../../lib/env";
import type { Notifier, WebhookEndpoints } from "../../lib/webhooks";
import { requireScope } from "../../middleware/auth";

const EVENTS: WebhookEventType[] = ["quota.warning", "quota.exceeded", "provider.outage"];

const webhookSchema = z.object({
  url: z.string().url().max(2048),
  secret: z.string().min(16).max(256),
  events: z.array(z.enum(["quota.warning", "quota.exceeded", "provider.outage"])).min(1),
});

export interface WebhookDeps {
  store: WebhookEndpoints;
  notify: Notifier;
}

export function webhookRoutes(deps: WebhookDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/webhooks", async (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorBody("Invalid JSON body", "invalid_request_error", "invalid_json"), 400);
    }
    const parsed = webhookSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(errorBody("Invalid webhook", "invalid_request_error", "validation_error"), 400);
    }
    const allowPrivate = (process.env["NODE_ENV"] ?? "development") !== "production";
    try {
      assertWebhookUrl(parsed.data.url, allowPrivate);
    } catch {
      return c.json(errorBody("Webhook URL not allowed", "invalid_request_error", "url_denied"), 400);
    }
    const created = await deps.store.add(auth.orgId, parsed.data.url, parsed.data.secret, parsed.data.events);
    return c.json({ id: created.id, url: created.url, events: created.events, supported: EVENTS }, 201);
  });

  app.get("/webhooks", async (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const data = await deps.store.list(auth.orgId).catch(() => null);
    if (!data) {
      return c.json(errorBody("Webhooks unavailable", "provider_error", "webhooks_unavailable"), 503);
    }
    return c.json({ object: "list", data });
  });

  app.delete("/webhooks/:id", async (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const ok = await deps.store.remove(auth.orgId, c.req.param("id")).catch(() => false);
    if (!ok) {
      return c.json(errorBody("Webhook not found", "invalid_request_error", "webhook_not_found"), 404);
    }
    return c.json({ deleted: true });
  });

  app.get("/webhooks/deliveries", (c) => {
    if (!requireScope(c, "keys:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    return c.json({ object: "list", data: deps.notify.deliveries(auth.orgId) });
  });

  return app;
}
