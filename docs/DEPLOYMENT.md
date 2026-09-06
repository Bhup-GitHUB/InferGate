# Deployment Runbook

## Prerequisites

Bun 1.3.5 (pinned in Dockerfiles), Postgres 16, Redis 7, a strong
`API_KEY_PEPPER` (32+ random hex chars), provider keys as needed.

## Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `API_KEY_PEPPER` | yes | none (boot fails) | rotate via `PEPPER_VERSION`+1, keep old pepper during grace |
| `DATABASE_URL` | prod | memory stores | enables PG keys/usage/plans/rules/webhooks |
| `REDIS_URL` | prod | per-process limits | shared limits, cache, locks, breaker/EWMA sync |
| `METRICS_TOKEN` | prod | open `/metrics` | bearer-gates Prometheus scrape |
| `RATE_LIMIT_PER_MINUTE` | no | 120 | per key+path bucket |
| `RATE_LIMIT_FAIL_OPEN` | no | false | fail-closed recommended |
| `DEFAULT_STRATEGY` | no | availability | cost/latency/availability/weighted/priority |
| `ALLOWED_ORIGINS` | no | http://localhost:3001 | console origin(s), comma-separated |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | no | mocks | live providers, egress-checked |
| `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` | no | official | override for gateways/vLLM |
| `PROVIDER_ALLOWLIST` | no | openai+anthropic | egress host allowlist |
| `ATTEMPT_TIMEOUT_MS` | no | 30000 | per-provider attempt budget |
| `PRINT_SEED_KEY` | no | unset | prints seed key to stderr (dev only) |

## Migrate

```bash
DATABASE_URL=... bun run packages/db/src/migrate.ts
```

Applies `packages/db/migrations/*.sql` in order inside per-file
transactions with an advisory lock. Re-runnable.

## Docker / Helm

```bash
docker build -f deployments/docker/Dockerfile.gateway -t infergate/gateway:0.1.0 .
helm install infergate deployments/helm/infergate \
  --set secrets.apiKeyPepper="$API_KEY_PEPPER" \
  --set secrets.databaseUrl="$DATABASE_URL" \
  --set secrets.redisUrl="$REDIS_URL"
```

## Smoke checks

```bash
curl localhost:3000/healthz
curl localhost:3000/readyz
curl localhost:3000/v1/models -H "authorization: Bearer $KEY"
GATEWAY_URL=http://localhost:3000 GATEWAY_KEY=$KEY bun run tests/compat/openai-sdk.ts
```

## Rollback

Stateless gateway: `helm rollback` or redeploy previous image. Migrations
are additive (`0001`..`0003`); never roll back `schema_migrations` rows.
Pepper rotation: deploy new pepper as `PEPPER_VERSION`+1 while keeping the
old value accepted (rotation-tolerant verify), then drop the old one.

## Shutdown

`SIGTERM`/`SIGINT` flips the gateway to draining: `/healthz` goes 503
(except the probe path itself), new traffic sheds, and the process exits
when in-flight requests finish or after 25s. The chart adds a 5s
`preStop` sleep so endpoints deregister first.
