import type { Context, Next } from "hono";
import { capsFor, checkQuota, monthWindow } from "@infergate/billing";
import type { AppEnv } from "../lib/env";
import { OrgPlans, type UsageStore } from "../lib/store";

export interface QuotaDeps {
  usage: UsageStore;
  plans: OrgPlans;
}

const SPEND_PREFIXES = ["/v1/chat/"];

export function quotaMiddleware(deps: QuotaDeps) {
  return async (c: Context<AppEnv>, next: Next) => {
    const isSpend = c.req.method !== "GET" && SPEND_PREFIXES.some((p) => c.req.path.startsWith(p));
    if (!isSpend) {
      await next();
      return;
    }
    const auth = c.get("auth") as AppEnv["Variables"]["auth"];
    const now = Date.now();
    const plan = deps.plans.get(auth.orgId);
    let used = { tokens: 0, spendUsd: 0 };
    try {
      const { start } = monthWindow(now);
      used = await deps.usage.periodUsage(auth.orgId, start);
    } catch {
      return c.json(
        { error: { message: "Billing unavailable", type: "quota_error", code: "billing_unavailable" } },
        503,
      );
    }
    const verdict = checkQuota(plan, used.tokens, used.spendUsd, now);
    if (!verdict.allowed) {
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
