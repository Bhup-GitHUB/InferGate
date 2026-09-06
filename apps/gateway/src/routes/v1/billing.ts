import { Hono } from "hono";
import { buildInvoice, capsFor, monthWindow, rollupDaily } from "@infergate/billing";
import { errorBody } from "@infergate/schemas";
import type { AppEnv, AuthContext } from "../../lib/env";
import { type PlanStore, type UsageStore } from "../../lib/store";
import { requireScope } from "../../middleware/auth";

export interface BillingDeps {
  usage: UsageStore;
  plans: PlanStore;
}

export function billingRoutes(deps: BillingDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/usage/daily", async (c) => {
    if (!requireScope(c, "usage:read")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const rawDays = Number(c.req.query("days") ?? "7");
    const days = Math.min(Math.max(Number.isFinite(rawDays) ? Math.floor(rawDays) : 7, 1), 90);
    const now = Date.now();
    const rows = await deps.usage.recordsByOrg(auth.orgId, now - days * 86400000).catch(() => null);
    if (!rows) {
      return c.json(errorBody("Usage unavailable", "provider_error", "usage_unavailable"), 503);
    }
    return c.json({ object: "usage_daily", org_id: auth.orgId, days: rollupDaily(rows, days, now) });
  });

  app.get("/billing/summary", async (c) => {
    if (!requireScope(c, "billing:read")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }    const auth = c.get("auth") as AuthContext;
    const plan = await deps.plans.get(auth.orgId).catch(() => "free");
    const caps = capsFor(plan);
    const { start, month } = monthWindow(Date.now());
    const [period, rows] = await Promise.all([
      deps.usage.periodUsage(auth.orgId, start),
      deps.usage.recordsByOrg(auth.orgId, start),
    ]).catch(() => null) ?? [null, null];
    if (!period || !rows) {
      return c.json(errorBody("Billing unavailable", "provider_error", "billing_unavailable"), 503);
    }
    const invoice = buildInvoice(rows, `${month}-01`, month);
    return c.json({
      object: "billing_summary",
      org_id: auth.orgId,
      plan: caps.plan,
      period: month,
      tokensUsed: period.tokens,
      tokenQuota: caps.monthlyTokens,
      spendUsd: Math.round(period.spendUsd * 1e6) / 1e6,
      quotaUsd: caps.monthlySpendUsd,
      invoice,
    });
  });

  app.post("/org/plan", async (c) => {
    if (!requireScope(c, "admin:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorBody("Invalid JSON body", "invalid_request_error", "invalid_json"), 400);
    }
    const plan = (body as { plan?: unknown }).plan;
    if (plan !== "free" && plan !== "pro" && plan !== "enterprise") {
      return c.json(errorBody("Unknown plan", "invalid_request_error", "invalid_plan"), 400);
    }
    try {
      await deps.plans.set(auth.orgId, plan);
    } catch {
      return c.json(errorBody("Unknown plan", "invalid_request_error", "invalid_plan"), 400);
    }
    return c.json({ org_id: auth.orgId, plan });
  });

  return app;
}
