# InferGate

One OpenAI-compatible endpoint for every model. Intelligent routing, quotas,
billing, and a live console — running locally in minutes.

```bash
cp .env.example .env
bun install
API_KEY_PEPPER=$(bun -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))") \
  PRINT_SEED_KEY=1 PORT=3000 bun run apps/gateway/src/index.ts
```

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "authorization: Bearer $SEED_API_KEY" \
  -H "content-type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Explain Kubernetes"}]}'
```

Or use the typed client (`@infergate/client`) or any OpenAI SDK pointed
at `$GATEWAY_URL/v1` — both are covered by integration tests.

## Console

```bash
bun run --cwd apps/web dev
```

Open http://localhost:3001, paste the seed key: overview, streaming
playground, activity feed, model catalog, GPU fleet simulator, key management,
webhooks, billing.

## What is inside

- `apps/gateway` — Hono/Bun gateway: auth, rate limits, quotas, routing with
  circuit breakers + failover, SSE streaming, billing, webhooks.
- `apps/web` — Next.js + Tailwind console (black glass, live charts).
- `packages/*` — auth (HMAC keys), providers (+egress guard), routing,
  billing, cache/Redis, scheduler sim, webhooks, db (Drizzle + PG migration).
- `services/*` — billing worker, health prober.
- `deployments/helm/infergate` — production chart (3→100 pods, HPA).
- `docs/` — decisions, audits, chaos evidence, load baseline, final review.

## API surface

`POST /v1/chat/completions` (JSON + `stream:true` SSE, idempotent replay,
`cache_ttl` + single-flight) · `POST /v1/embeddings` · `GET /v1/models[/id]` ·
key mint/list/rotate/revoke (+expiry, no-escalation) · `GET /v1/usage[/daily]`
· `GET /v1/requests` · `GET /v1/billing/summary` · `POST /v1/org/plan` ·
`GET /v1/routing/health` + rules CRUD · webhooks CRUD + deliveries ·
`POST /v1/scheduler/placement` · `GET /v1/audit` · `/healthz` (drain-aware)
`/readyz` `/metrics` (gated).

## Production path

Set `API_KEY_PEPPER`, `DATABASE_URL`, `REDIS_URL`, `METRICS_TOKEN`;
see `FINAL_REVIEW.md` for the PG-backed multi-pod milestone before scaling out.
