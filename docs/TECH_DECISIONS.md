# Tech Decisions

CTO-approved stack decisions for InferGate. Each decision evaluated for 100x growth.

---

## Decision: Runtime — Bun 1.3.x (pinned)

Why chosen:
- Native TypeScript, `Bun.serve` (uWS-based) gives highest single-node throughput for gateway workloads.
- Built-in `bun:sql`, `bun:test`, workspaces, dotenv reduce dependency surface.
- Startup ~10ms enables fast K8s scale-up and cheap workers.

Alternatives considered:
- Node 22 + Fastify: mature ecosystem, larger hiring pool, but 5-10x slower router throughput, slower cold start.
- Deno: good security model, smaller ecosystem, less K8s/Helm precedent.

Tradeoffs: Bun is younger; occasional stream/pg edge bugs. Mitigate by pinning version in Dockerfile + CI, running load tests per upgrade.
Future risks: API churn in `bun:sql`. Mitigate via Drizzle abstraction + raw-SQL escape hatch only.

## Decision: API Framework — Hono v4 on Bun

Why chosen:
- Bun-native + portable (Bun/Node/Cloudflare Workers/Lambda with zero rewrite).
- Realistic throughput ~62k ops/s with validation — 400x over 10k req/min target; bottleneck is upstream LLM, not router.
- `streamSSE`/`streamText` on Web Standards Response maps 1:1 to OpenAI `stream:true` dual-mode.
- Middleware ecosystem (CORS, JWT, body-limit, tracing) + typed `hc` client.
- ~22k stars, 1.8-9.3M weekly downloads, used by Cloudflare.

Alternatives considered:
- Elysia: faster peak (~71k ops/s, Sucrose AOT) but Bun-only, smaller ecosystem, TypeBox friction.
- Fastify-on-Bun: 300+ plugins, enterprise-proven, but Node-centric compat layer, no Workers, heavier.
- Express: largest pool, legacy, ~80k slower path. Rejected.

Tradeoffs: cedes ~15-30% peak throughput to Elysia; `hc` RPC less mature than Eden.
Future risks: reliance on Cloudflare team velocity. Portable standards limit lock-in.
Verdict: survives 100x (1M req/min ≈ 16.7k r/s, <5% single-node capacity + horizontal scale).

## Decision: ORM — Drizzle ORM on `bun:sql` (+ raw SQL escape hatch)

Why chosen:
- First-class `bun-sql` support, zero native binaries, ~30KB thin layer, 50ms cold start.
- 2-3x faster than Prisma (0.8ms vs 2.1ms simple SELECT; 45ms vs 120ms bulk 1k insert); ~8% overhead vs raw SQL with prepared statements.
- SQL-like builder + `sql``` for CTEs, window functions, billing rollups; `drizzle-kit` plain-SQL migrations.
- TS-inferred types, no codegen step.

Alternatives considered:
- Prisma: best DX/Studio, good for junior teams. Rejected: engine bloat, weaker aggregation control, Bun adapter friction.
- Kysely: fastest/thinnest. Rejected: no relations/migrations, codegen drift risk.
- Raw pg/bun:sql only: max throughput. Rejected: no types/migrations, schema drift.

Tradeoffs: Drizzle v1 maturing; RQB can N+1 if misused → enforce explicit selects + EXPLAIN review.
Future risks: Bun concurrent-statement bug → pin Bun, pool via Drizzle, partition `requests` by time, batch billing inserts.

## Decision: Realtime — Hono `streamSSE()` on `Bun.serve` (no Socket.IO)

Why chosen:
- `POST /v1/chat/completions?stream=true` is unidirectional HTTP SSE, not bidirectional sockets. Plain Response/ReadableStream passthrough is the correct primitive.
- Bun.serve already runs uWS C++ core; p50 ~1ms overhead, 10k+ streams/core.
- OpenAI-compatible (`data: {...}`, `data: [DONE]`), edge-portable, backpressure + abort via web streams.

Alternatives considered:
- Socket.IO: 19x slower (~7k vs 142k rps), Redis+sticky needed, custom protocol breaks OpenAI clients. Rejected.
- uWebSockets.js raw: fastest raw WS but WS API ≠ SSE, duplicate stack (Bun already uses uWS), hard debug. Rejected.
- Bun native Response SSE manual: same perf, re-implements Hono helpers. Rejected.

Tradeoffs: SSE text-only, no multiplexing; needs 30s heartbeat + `X-Accel-Buffering: no`.
Future risks: Bun stream abort bugs → pin version, prefer `new Response(upstream.body)` passthrough over manual reader loops, `stream.onAbort()` + idle timeout guards.

## Decision: Database — PostgreSQL 16 + Redis 7

Why chosen: PG for durable billing/auth state (ACID, partitioning, BRIN/btree); Redis for hot path only (rate limits via LUA, health EWMA, key cache, billing streams).
Alternatives: MySQL (weaker CTE/window/partition story), Scylla/Dynamo (ops cost, no need yet).
Risks: PG write hotspot on `requests` → time-partition + async batch inserts via Redis Stream worker.

## Decision: Observability — OpenTelemetry + Prometheus + structured logging

Why chosen: vendor-neutral traces (request→router→provider→db→redis), Prom metrics (`requests_total`, `tokens_total`, `latency_seconds`, `provider_errors`, `routing_decisions`, `cost_total`), JSON logs for Loki/ELK.
Alternatives: Datadog-only SDK (lock-in), raw StatsD (no traces).
Risks: cardinality explosion on per-org labels → bound label sets, aggregate billing separately.

## Decision: Infra — Docker + Kubernetes + Helm

Why chosen: stateless gateway scales via HPA; workers/health-probers as Deployments; PG/Redis via operators or managed services in prod; Helm for env parity.
Alternatives: Fly/Render PaaS (simpler, less control), Nomad (smaller pool).
Risks: K8s ops burden → start with managed PG/Redis, Helm charts from day one.
