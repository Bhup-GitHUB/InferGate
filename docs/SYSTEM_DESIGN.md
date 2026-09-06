# System Design

## Scope (shipped; beyond Phase 1 baseline)

OpenAI-compatible `POST /v1/chat/completions` (non-stream + SSE stream), `GET /v1/models`, API key auth with orgs/scopes/rotation, provider abstraction with 3 mock providers by default plus live OpenAI + Anthropic adapters when `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are set (egress-gated, `kind: live|mock` surfaced on routing health), per-org routing rules (`GET/POST/DELETE /v1/routing/rules`, `GET /v1/routing/health`), key management, usage feed, billing summary with quotas (402 + webhook on over-quota), webhooks with signed delivery + delivery log, scheduler placement/demo, embeddings as a 64-dim deterministic mock, synchronous request logging (direct `requests` insert, idempotency via `ON CONFLICT (org_id, idempotency_key)`).

## Non-goals (still out)

Redis-Streams billing worker (usage inserts are synchronous today), `requests` table partitioning (BRIN index present; RANGE partition deferred until >10M rows), K8s deploys, persistent webhook store (in-memory `WebhookStore`, cap 50 deliveries).

## Stores and middleware (as wired in `apps/gateway/src/app.ts`)

- Key/usage/rules backend: Postgres (`PgKeyStore`, `PgUsageStore`, `PgRuleStore`) when `DATABASE_URL` is set, else in-memory (`MemoryKeyStore`, `MemoryUsageStore`, in-memory rules). `RuleCache` adds a 30s TTL (`backend: postgres|memory` exposed on `GET /v1/routing/rules`).
- Key cache: `CachedKeyStore` wraps the key store — 30s TTL, local LRU-ish map (cap 5000) plus Redis `key:prefix:*`; invalidated on save/revoke; Redis errors fall back to the inner store.
- Middleware chain on `/v1/*`: tracing → CORS (`ALLOWED_ORIGINS`) → body limit (`BODY_LIMIT_BYTES`, default 1MB) → auth → per-key+path token-bucket rate limit (`RedisTokenBucket` when `REDIS_URL` set, else in-memory; fail-open per `RATE_LIMIT_FAIL_OPEN`) → quota.
- Breakers are shared across pods via Redis `breaker:{providerId}` keys (set `open` with `PX cooldown` on fresh open in chat failover; 5s poller calls `forceOpen`), in addition to per-process `CircuitBreaker`s.
- Ops endpoints: `GET /healthz`, `GET /readyz` (per-provider health + PG ping, 503 when nothing healthy or PG down), `GET /metrics` (Prometheus; `Bearer METRICS_TOKEN`, 403 on mismatch, open when unset).

## Data flow

See ARCHITECTURE.md pipeline. Key invariants:
- Auth is synchronous (prefix lookup → HMAC verify → active check); usage logging is synchronous direct insert (no Redis Stream / worker).
- Streaming never buffers full completion; passthrough generator → SSE.
- Every chat request may consult the completion cache (`cache:completion:{org}:{hash}`, TTL 1..3600s, non-stream only, `x-infergate-cache: HIT|MISS`; hits bill $0 but still insert a usage row), then tries ordered failover candidates (rule strategy, up to `maxAttempts`, capped at 5) with per-attempt timeout (`ATTEMPT_TIMEOUT_MS`).
- Routes mounted under `/v1` (all auth + rate-limit + quota guarded): chat, embeddings (mock), models, keys, usage, billing, webhooks (+ deliveries), scheduler, routing.
- Embeddings (`POST /v1/embeddings`) are a deterministic SHA-256 mock (64 dims, `model:text` seeded) — swap for live provider embeddings before launch.

## Failure modes

| Failure | Behavior |
|---|---|
| Provider 5xx/timeout | failover across ordered candidates up to `maxAttempts`, else 502 `provider_unavailable`; fresh breaker-open emits `provider.outage` webhook and writes shared `breaker:{id}` key |
| PG down | no serve-from-cache fallback for usage/rules; auth degrades only to the 30s key-cache window, then 503 `auth_unavailable`; rules read fails 503 `rules_unavailable`; `GET /readyz` reports `db: fail` |
| Redis down | fail-open rate limit (log warn) or fail-closed per env `RATE_LIMIT_FAIL_OPEN`; key lookup falls back to inner PG/memory store; completion cache reads/writes skipped |
| Client abort | propagate AbortSignal to provider, close SSE, still log usage |

## Capacity plan

Single Bun pod: ~60k r/s validation path; realistic LLM-bound ~500 concurrent streams/core. HPA at 70% CPU or p95 > 800ms. PG: partitioned `requests`, BRIN on created_at; Redis: 1GB suffices for limits+health at 10k r/min.
