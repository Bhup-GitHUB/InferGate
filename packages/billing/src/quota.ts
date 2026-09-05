import { capsFor, monthKey } from "./plans";

export interface PeriodUsage {
  tokens: number;
  spendUsd: number;
  month: string;
}

export interface QuotaVerdict {
  allowed: boolean;
  reason: string | null;
  period: PeriodUsage;
}

export function checkQuota(plan: string, usedTokens: number, usedSpend: number, now: number): QuotaVerdict {
  const caps = capsFor(plan);
  const period: PeriodUsage = { tokens: usedTokens, spendUsd: usedSpend, month: monthKey(now) };
  if (usedTokens >= caps.monthlyTokens) {
    return { allowed: false, reason: `Monthly token quota exceeded for plan ${caps.plan}`, period };
  }
  if (usedSpend >= caps.monthlySpendUsd) {
    return { allowed: false, reason: `Monthly spend quota exceeded for plan ${caps.plan}`, period };
  }
  return { allowed: true, reason: null, period };
}
