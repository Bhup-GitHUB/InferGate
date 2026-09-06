# TODO

## Shipped
- [x] Phase 1 — Foundation: gateway, auth (HMAC+salt+pepper), OpenAI APIs, SSE, mocks
- [x] Phase 2 — Routing: 5 strategies, EWMA health, breakers, failover, org rules API
- [x] Phase 3 — Billing: quotas (402 + stream budget), daily rollups, summaries, invoices, plans
- [x] Phase 4 — Distributed: Redis LUA limiter, response cache, locks, PG stores + migrate runner
- [x] Phase 5 — Observability: Prometheus metrics (gated), structured logs, Server-Timing, tracing spans
- [x] Phase 6 — Kubernetes: gateway Dockerfile, Helm chart (HPA, probes, secrets)
- [x] Phase 7 — Scheduler sim + placement API + fleet page
- [x] Phase 8 — Security audit + SSRF/egress/scope fixes
- [x] Phase 9 — Tests (74), load harness (635 rps), perf profile (single-digit ms overhead)
- [x] Phase 10 — Chaos tests with live evidence
- [x] Live providers: OpenAI + Anthropic HTTP adapters behind env keys + egress guard
- [x] Webhooks: HMAC-signed quota/outage alerts + deliveries log
- [x] Console: 9 Tailwind pages (overview, playground, activity, routing, models, fleet, keys, webhooks, billing)

## Next milestones
- [x] PG-backed plans, webhooks, idempotency write-ahead, shared breaker state
- [ ] Shared EWMA latency state in Redis
- [ ] Idempotent replay (return original response instead of 409)
- [ ] Billing worker draining Redis stream → `usage_daily`/`invoices` writes
- [ ] OTLP exporter wiring + Grafana dashboards
- [ ] Real-model load numbers + HPA tuning on staging
- [ ] Multi-region: read replicas, pinned routing, global rate limits
