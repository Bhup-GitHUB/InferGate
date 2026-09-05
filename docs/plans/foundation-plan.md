# Foundation Plan (Phase 1) — Rev 2 (addresses CTO review)

## Problem

Working OpenAI-compatible gateway skeleton: authenticated chat completions (JSON + SSE), model listing, provider abstraction with mocks, strong API key hashing with rotation, DB schema + verified migrations, ready/health probes, rate limiting wired, so later phases have a solid base.

## Proposed solution

Bun workspaces monorepo. `apps/gateway` (Hono) with tracing/auth/ratelimit/validation middleware; `packages/*` shared libs; `services/*` minimal honest stubs that are never on the request path; Drizzle PG schema; mock providers with latency distributions; SSE via `streamSSE` with timeouts.

## Architecture changes

- New: `apps/gateway/src/{index.ts,routes/v1/{chat.ts,models.ts,keys.ts},middleware/{tracing.ts,auth.ts,ratelimit.ts,validate.ts,errors.ts},lib/{config.ts,readiness.ts}}`
- New: `packages/{providers,auth,schemas,db,ratelimit,otel}` with typed interfaces.
- New: `services/{billing-worker,health-prober}` stubs that only log on boot and exit idle; NOT on request path.
- New: `deployments/docker/Dockerfile.gateway`; Helm deferred to Phase 6.
- Stateless rule: zero in-memory Maps for auth/billing on request path. Phase 1 key lookup is direct PG prepared query (pooled, 30s statement timeout). Redis wiring lands in Phase 4; interfaces defined now.

## Database changes

All 10 tables per DATABASE_DESIGN.md via Drizzle `schema.ts` + `0001_foundation.sql`. Indexes on `api_keys.prefix`, `models.alias`, `requests(org_id,created_at)`. Retention: `requests` rows older than 90 days purged by nightly job (Phase 4 worker; documented now). Partitioning deferred to Phase 3 with trigger threshold at 10M rows.

## API changes

- `GET /healthz` → liveness `{ok:true}` no auth, no DB.
- `GET /readyz` → readiness `{db:ok, providers:{id:ok}}`, 503 on failure, no auth (for K8s probes, rate-limited by IP).
- `GET /v1/models` → requires valid key with `models:read` scope, list from registry.
- `POST /v1/chat/completions` → requires `chat:write` scope (JSON + `stream:true` SSE).
- `POST /v1/keys/:id/rotate` → requires `keys:write` scope; atomic DB transaction creating successor, setting `rotated_from_id`, 24h grace dual-accept, auto-revoke old.
- Rate limiting enforced on all `/v1/*` via Redis-interface middleware (in-memory token bucket per process ONLY as dev fallback when `REDIS_URL` unset; prod requires Redis, fail-closed when `RATE_LIMIT_FAIL_OPEN=false`).

## Security considerations

- Key hashing: HMAC-SHA256(secret, pepper) with unique per-key 16-byte salt stored alongside; pepper from env `API_KEY_PEPPER` (K8s Secret in prod), rotation via versioned `pepper_version` column supporting N-1 grace. Constant-time compare, prefix lookup. Replaces plain SHA-256.
- Org scoping from verified key only, never body. Zod strict validation. Body limit 1MB (`bodyLimit` middleware). Error shape never leaks secrets.
- Provider `base_url` allowlist from env `PROVIDER_ALLOWLIST` (comma-separated, default localhost + api.openai.com + api.anthropic.com); user cannot supply URLs.
- No auth cache in Phase 1 → no cross-instance invalidation gap. Revocation immediate via `revoked_at` check per request.
- Logs redact `authorization` header.

## Scalability considerations

- Stateless gateway; direct PG auth query is the only sync DB hit (prepared, pooled max 20/pod, 5s timeout). Load target Phase 1: 100 r/s single pod; horizontal scale thereafter.
- Billing writes are synchronous `INSERT INTO requests` in Phase 1 (honest, no lossy queue); async Redis Stream batching lands in Phase 4 behind the same `logUsage()` interface.
- Streaming passthrough with AbortSignal, idle timeout 60s, max duration 300s, per-token flush, `data: [DONE]` close, `X-Accel-Buffering: no`.

## Testing approach

`bun test`: unit (auth HMAC hash/verify/rotation, schemas validation, provider registry, mock stream frames, ratelimit bucket), integration (Hono app with pg-mem/ephemeral PG: 401 without key, 200 JSON completion, SSE ends `[DONE]`, models requires scope, rotate grace works, readiness reflects DB down).
CI: GitHub workflow with ephemeral Postgres 16 + Redis 7 services; contract tests hit real PG/Redis. `bun test` green required.

## Observability

- OTel SDK with OTLP exporter (`OTEL_EXPORTER_OTLP_ENDPOINT`), trace per request (auth→route→provider spans).
- Prometheus `GET /metrics` (`requests_total`, `tokens_total`, `latency_seconds`, `provider_errors_total`).
- Structured JSON logs with `requestId`, `orgId`, `provider`, `latencyMs`. Alert thresholds documented: p95 > 2s, 5xx > 1%.

## Risks

- Bun SSE abort edge cases → onAbort + timeouts + abort test; pin Bun 1.3.5.
- Drizzle RQB N+1 → explicit selects only.
- Scope creep → routing/billing policies deferred; stubs off request path.
