export interface PlanCaps {
  plan: string;
  monthlyTokens: number;
  monthlySpendUsd: number;
}

export const PLANS: Record<string, PlanCaps> = {
  free: { plan: "free", monthlyTokens: 1000000, monthlySpendUsd: 10 },
  pro: { plan: "pro", monthlyTokens: 100000000, monthlySpendUsd: 1000 },
  enterprise: { plan: "enterprise", monthlyTokens: Number.MAX_SAFE_INTEGER, monthlySpendUsd: Number.MAX_SAFE_INTEGER },
};

export function capsFor(plan: string): PlanCaps {
  return PLANS[plan] ?? PLANS["free"];
}

export function monthKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
