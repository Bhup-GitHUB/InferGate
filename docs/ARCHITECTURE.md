# Architecture

## Status

Milestone 1 (this tree): single-node gateway with in-memory key/usage/plan stores,
per-process routing health, and mock providers. PostgreSQL schema + migrations,
Redis coordination interfaces, workers, and Helm charts exist; PG/Redis-backed
stores are the next milestone (see FINAL_REVIEW.md for the honest gap list).
Deploy more than one pod only after that migration.

## Overview

InferGate is a stateless OpenAI-compatible inference gateway.

```
Client → API Gateway (Hono/Bun, stateless) → Auth → RateLimit → Validate → Routing Engine → Provider Layer → AI Models
                                              ↓                                                     ↓
                                    Redis (hot path)                                    OTel traces + billing stream → Worker → PG
```

## Components

- `apps/gateway`: Hono on Bun. Routes `GET /healthz`, `GET /v1/models`, `POST /v1/chat/completions` (JSON + SSE), `POST /v1/keys/*`. Middleware: tracing, auth, rateLimit, validation, error mapping.
- `packages/providers`: `ProviderAdapter` interface (`chatCompletion`, `streamCompletion`, `healthCheck`, `mapModel`) + `openai.ts`, `anthropic.ts`, `local-vllm.ts` mocks + `registry.ts`.
- `packages/auth`: key format `ig_sk_<prefix>_<secret>`, SHA-256 hashed storage, constant-time verify, rotation with 24h grace.
- `packages/schemas`: Zod OpenAI-compatible request/response validation.
- `packages/db`: Drizzle schema + migrations (users, organizations, api_keys, providers, models, requests, usage, invoices, routing_rules).
- `packages/ratelimit`: Redis LUA token-bucket + sliding window.
- `packages/otel`: OTel SDK, Prometheus `/metrics`, trace helpers.
- `services/billing-worker`: consumes Redis Stream `billing:usage`, batch inserts to PG.
- `services/health-prober`: 30s provider probes → Redis health + PG.

## Request pipeline (p95 target: provider p95 + 15ms)

1. tracing: traceId, span `gateway.request`
2. auth: `Bearer ig_sk_*` → prefix lookup (Redis cache 30s → PG) → sha256 compare → orgId/keyId/scopes
3. rateLimit: Redis LUA `rl:{org}:{model}`; 429 + Retry-After
4. validate: Zod → InternalChatRequest
5. routing: candidates by health + EWMA latency + cost + org policy
6. provider: chat or stream; normalize to OpenAI SSE
7. billing: `XADD billing:usage` (never await PG)
8. stream: `streamSSE`, per-token flush, `data: [DONE]`

Failover: on 429/5xx/timeout retry 1x next healthy provider; headers `x-infergate-provider`, `x-infergate-retry`.

## Scalability (100x)

- Stateless gateway, HPA on RPS/p95. 3→100 pods.
- Redis hot path only; PG off request path except cached key lookup.
- Async billing batch (500 rows/5s) survives PG downtime.
- pg-pool max 20/pod, statement_timeout 5s; provider fetch keep-alive, circuit breaker (5 fails/30s open).
