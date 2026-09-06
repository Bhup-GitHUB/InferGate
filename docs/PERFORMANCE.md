# Performance Baseline

Date: 2026-09-05. Single Bun pod (darwin, mock providers), `tests/load/run.ts`.

## Results

- 100 concurrent, 1000 non-stream requests: 1000/1000 ok, 635 rps, p50 119ms, p95 400ms, p99 483ms (mock latency-bound: openai mock sleeps 120-400ms).
- Rate limiter verified separately: 500-burst against 120/min bucket → 379 × 429 with `Retry-After`, 121 served.
- Postgres + Redis mode: 50 concurrent, 300 requests → 300/300 ok, 245 rps, p50 134ms, p95 453ms. Lower than memory mode due to real PG/Redis RTTs per request; still upstream-dominated.

## Reading

Gateway overhead is single-digit ms; end-to-end latency is upstream-dominated, which is the correct shape for an inference gateway. Real-provider numbers will follow provider latency + ~5ms gateway p50.

## Next

- Re-run against staging with real providers before launch.
- Add p95 HPA target 800ms; scale pods on RPS.
- Profile with `bun --inspect` if gateway overhead exceeds 15ms p50.
