export interface UsageRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  status: string;
  createdAt: number;
}

export interface DailyBucket {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface InvoiceDraft {
  periodStart: string;
  periodEnd: string;
  amountUsd: number;
  status: "draft";
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function rollupDaily(rows: UsageRow[], days: number, now: number): DailyBucket[] {
  const buckets = new Map<string, DailyBucket>();
  for (let i = 0; i < days; i += 1) {
    const key = dayKey(now - i * 86400000);
    buckets.set(key, { date: key, requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
  }
  for (const row of rows) {
    if (row.status !== "ok") {
      continue;
    }
    const key = dayKey(row.createdAt);
    const bucket = buckets.get(key);
    if (!bucket) {
      continue;
    }
    bucket.requests += 1;
    bucket.inputTokens += row.inputTokens;
    bucket.outputTokens += row.outputTokens;
    bucket.costUsd += row.costUsd;
  }
  for (const bucket of buckets.values()) {
    bucket.costUsd = Math.round(bucket.costUsd * 1e6) / 1e6;
  }
  return [...buckets.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function buildInvoice(rows: UsageRow[], periodStart: string, periodEnd: string): InvoiceDraft {
  let amount = 0;
  for (const row of rows) {
    if (row.status === "ok") {
      amount += row.costUsd;
    }
  }
  return {
    periodStart,
    periodEnd,
    amountUsd: Math.round(amount * 1e6) / 1e6,
    status: "draft",
  };
}

export function monthWindow(now: number): { start: number; month: string } {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start, month };
}
