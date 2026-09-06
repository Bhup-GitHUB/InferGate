# Gateway Perf Profile — `POST /v1/chat/completions` (non-stream, mock)

Measured 2026-09-06: gateway on :3215, 20 warmup + 200 sequential `gpt-4o-mini`
requests via curl. Gateway = `Server-Timing: gateway;dur=` (tracing middleware);
e2e = curl wall clock (localhost, includes TCP + HTTP framing + curl spawn).

## Results (ms)

| metric | e2e | gateway (Server-Timing) | net/process overhead (e2e − gw) |
|---|---|---|---|
| p50 | 268.0 | 254.0 | 14.4 |
| p95 | 391.8 | 376.0 | 19.4 |
| mean | 267.6 | 253.1 | 14.5 |
| min–max | 133–415 | 121–399 | — |

Mock `openaiMock` sleeps uniform 120–400ms (expected mean 260ms).
Observed gateway mean 253ms ≈ mock mean: **~95% of latency is the mock
sleep; overhead is ~5% (~14ms, mostly curl/HTTP, not
gateway code).** Gateway fixed cost is single-digit ms.

## Per-request overhead ranking (est. cost, non-stream)

| # | source | location | est. |
|---|---|---|---|
| 1 | Quota `periodUsage` full-table scan O(n) per request | `middleware/quota.ts` → `lib/store.ts:115` | µs now, **grows to ms** at 50k-row cap |
| 2 | Zod `chatCompletionRequestSchema.safeParse` | `routes/v1/chat.ts:90` | ~0.2–1ms |
| 3 | `c.req.json()` parse + `c.json()` serialize | `chat.ts:86,222` | sub-ms (small bodies) |
| 4 | Tracing: `crypto.randomUUID` + `console.log` per request (sync stdout) | `middleware/tracing.ts` | ~0.1–0.5ms, blocks event loop |
| 5 | Auth: `parseKey` + store lookup + 1× HMAC-SHA256 verify | `middleware/auth.ts` | µs (cheap HMAC, no KDF) |
| 6 | Rule fetch + `pickRule`/`candidatesFor`/`orderCandidates` | `chat.ts:114-117` | µs (tiny in-memory sorts) |
| 7 | In-memory rate-limiter bucket check | `middleware/ratelimit.ts` | µs (would be ~ms with Redis) |
| 8 | SSE framing | `chat.ts` stream path only | 0 for non-stream |

## Top 3 optimizations

1. **Cache quota usage** (biggest scaling win): `periodUsage` scans all rows on
   every spend request — O(n²) traffic cost, 50k rows worst case. Maintain a
   monthly counter incremented on `usage.insert`. Expected: flat ~µs quota
   check at any volume vs linear degradation today.
2. **Make request logging async/sampled**: per-request `console.log` +
   `structuredLog` serializes on the event loop. Buffer or sample (e.g. 1–10%
   + all errors). Expected: ~0.1–0.5ms off p50/p95 tail, less event-loop
   jitter under concurrency.
3. **Skip/trim Zod on hot path**: validate once with a lean schema or cache
   the compiled schema path; avoid re-validating defaults. Expected: shave
   ~0.2–0.5ms fixed cost per request (~10% of non-mock gateway time).
