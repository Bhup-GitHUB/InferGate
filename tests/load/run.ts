const BASE = process.env["GATEWAY_URL"] ?? "http://localhost:3000";
const KEY = process.env["GATEWAY_KEY"] ?? "";
const CONCURRENCY = Number(process.env["LOAD_CONCURRENCY"] ?? "50");
const TOTAL = Number(process.env["LOAD_TOTAL"] ?? "500");
const STREAM = process.env["LOAD_STREAM"] === "1";

if (!KEY) {
  console.error("GATEWAY_KEY is required");
  process.exit(1);
}

async function one(): Promise<{ ok: boolean; ms: number }> {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "auto",
        messages: [{ role: "user", content: "Load test ping" }],
        stream: STREAM,
      }),
    });
    if (STREAM) {
      await res.text();
    } else {
      await res.json();
    }
    return { ok: res.status === 200, ms: Date.now() - started };
  } catch {
    return { ok: false, ms: Date.now() - started };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const latencies: number[] = [];
let ok = 0;
let started = 0;

async function worker(): Promise<void> {
  while (started < TOTAL) {
    started += 1;
    const r = await one();
    latencies.push(r.ms);
    if (r.ok) {
      ok += 1;
    }
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const secs = (Date.now() - t0) / 1000;
latencies.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      total: TOTAL,
      ok,
      failed: TOTAL - ok,
      rps: Math.round((TOTAL / secs) * 10) / 10,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
    null,
    2,
  ),
);
