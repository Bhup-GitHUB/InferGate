# TODO

## Phase 1 — Foundation (in progress)
- [x] Tech due diligence (Hono, Drizzle, SSE)
- [x] Docs: TECH_DECISIONS, ARCHITECTURE, SYSTEM_DESIGN, DATABASE_DESIGN, API_DESIGN, SECURITY
- [ ] Plan review (Architecture Agent)
- [ ] Implement: repo scaffolding, auth, schemas, providers, gateway routes, db migrations, tests
- [ ] Code review + testing + security review + commit

## Phase 2 — Routing engine
- [ ] Cost/latency/availability/weighted/priority routing, health checks, circuit breakers, retries

## Phase 3 — Billing
- [ ] Token tracking, quotas, usage APIs, aggregation, idempotency

## Phase 4 — Distributed systems
- [ ] Redis rate limiting, caching, locks, background workers

## Phase 5 — Observability
- [ ] OTel traces, Prometheus metrics, structured logging

## Phase 6 — Kubernetes
- [ ] Docker, manifests, Helm, autoscaling

## Phase 7 — Model scheduler
- [ ] Fake GPU servers, placement logic

## Phase 8 — Security audit
- [ ] External-style audit + fixes

## Phase 9 — Testing
- [ ] Unit/integration/e2e + load (1k concurrent, 10k req/min)

## Phase 10 — Chaos engineering
- [ ] Outage/failure injection + recovery docs
