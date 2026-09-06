import type { Context, Next } from "hono";
import { capsFor, checkQuota, monthWindow } from "@infergate/billing";
import type { AppEnv } from "../lib/env";
import { type PlanStore, type UsageStore } from "../lib/store";
import { Notifier, type WebhookEndpoints } from "../lib/webhooks";

export interface QuotaDeps {
  usage: UsageStore;
  plans: PlanStore;
  webhooks: WebhookEndpoints;
  notify: Notifier;
}

const SPEND_PREFIXES = ["/v1/chat/"];
const USAGE_TTL_MS = 5000;
const usageCache = new Map<string, { used: { tokens: number; spendUsd: number }; at: number }>();

async function cachedUsage(usage: UsageStore, orgId: string, start: number): Promise<{ tokens: number; spendUsd: number }> {
  const now = Date.now();
  const hit = usageCache.get(orgId);
  if (hit && now - hit.at < USAGE_TTL_MS) {
    return hit.used;
  }
  const used = await usage.periodUsage(orgId, start);
  usageCache.set(orgId, { used, at: now });
  if (usageCache.size > 1000) {
    const first = usageCache.keys().next().value;
    if (first) {
      usageCache.delete(first);
    }
  }
  return used;
}

export function quotaMiddleware(deps: QuotaDeps) {
  return async (c: Context<AppEnv>, next: Next) => {
    const isSpend = c.req.method !== "GET" && SPEND_PREFIXES.some((p) => c.req.path.startsWith(p));
    if (!isSpend) {
      await next();
      return;
    }
    const auth = c.get("auth") as AppEnv["Variables"]["auth"];
    const now = Date.now();
    const plan = await deps.plans.get(auth.orgId).catch(() => "free");
    let used = { tokens: 0, spendUsd: 0 };
    try {
      const { start } = monthWindow(now);
      used = await cachedUsage(deps.usage, auth.orgId, start);
    } catch {
      return c.json(
        { error: { message: "Billing unavailable", type: "quota_error", code: "billing_unavailable" } },
        503,
      );
    }
    const verdict = checkQuota(plan, used.tokens, used.spendUsd, now);
    if (!verdict.allowed) {
      deps.notify.emit(deps.webhooks, auth.orgId, "quota.exceeded", {
        plan,
        tokens: used.tokens,
        spendUsd: used.spendUsd,
      });
      return c.json(
        { error: { message: verdict.reason ?? "Quota exceeded", type: "quota_error", code: "quota_exceeded" } },
        402,
      );
    }
    const caps = capsFor(plan);
    c.set("quota", {
      remainingTokens: Math.max(0, caps.monthlyTokens - used.tokens),
      remainingSpend: Math.max(0, caps.monthlySpendUsd - used.spendUsd),
    });
    await next();
  };
}
