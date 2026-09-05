# System Design

## Scope (Phase 1)

OpenAI-compatible `POST /v1/chat/completions` (non-stream + SSE stream), `GET /v1/models`, API key auth with orgs/permissions/rotation, provider abstraction with 3 mock providers, request logging + usage prep.

## Non-goals (Phase 1)

Cost/latency routing policies, quotas/billing aggregation APIs, Redis rate limit enforcement (interface + in-memory only), K8s deploys, scheduler.

## Data flow

See ARCHITECTURE.md pipeline. Key invariants:
- Auth is synchronous; billing is async (Redis Stream).
- Streaming never buffers full completion; passthrough generator → SSE.
- Every request emits trace + `requests` row (via worker) with idempotency key support.

## Failure modes

| Failure | Behavior |
|---|---|
| Provider 5xx/timeout | 1x failover to next healthy, else 502 `provider_unavailable` |
| PG down | serve from Redis cache; billing queues in stream; 503 on key-miss only |
| Redis down | fail-open rate limit (log warn) or fail-closed per env `RATE_LIMIT_FAIL_OPEN`; key lookup falls back to PG |
| Client abort | propagate AbortSignal to provider, close SSE, still log usage |

## Capacity plan

Single Bun pod: ~60k r/s validation path; realistic LLM-bound ~500 concurrent streams/core. HPA at 70% CPU or p95 > 800ms. PG: partitioned `requests`, BRIN on created_at; Redis: 1GB suffices for limits+health at 10k r/min.
