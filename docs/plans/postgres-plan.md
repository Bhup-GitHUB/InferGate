# Postgres-Backed Stores Plan

## Problem

Gateway state is per-process memory. Multi-pod deploys diverge on keys,
usage, quotas, and idempotency. PG schema exists but nothing reads it.

## Proposed solution

`packages/db` gains `PgKeyStore` + `PgUsageStore` implementing the gateway
`KeyStore`/`UsageStore` interfaces with `postgres.js` parameterized queries.
Gateway uses PG stores when `DATABASE_URL` is set, memory otherwise (logged
at boot). `GET /readyz` gains a `db` check when PG is configured.
`packages/db/src/migrate.ts` applies `migrations/*.sql` in order.

## Architecture changes

- New `packages/db/src/stores.ts` (no comments, pure SQL, prepared).
- `apps/gateway/src/app.ts`: `DATABASE_URL` → PG stores; readiness includes PG.
- Timestamp mapping: PG timestamptz ↔ epoch ms at the boundary only.

## Database changes

Use migration `0001_foundation.sql` (composite `(org_id, idempotency_key)`
already fixed). Idempotency insert uses `ON CONFLICT DO NOTHING` +
`RETURNING` to detect replays atomically.

## API changes

- `GET /readyz` → `{ ready, providers, db: ok|unconfigured|fail }`.
- 409 replay path unchanged; PG conflict maps to the same 409.

## Security considerations

- Parameterized queries only; `statement_timeout` 5s; pool max 20.
- Connection string from env/secret only; never logged.

## Testing approach

Ephemeral Postgres 16 in Docker; `TEST_DATABASE_URL` gates
`tests/pg.test.ts` (CRUD keys, rotation grace, usage insert + replay
conflict, period sums, recent ordering). Redis LUA/cache/lock tests gate on
`TEST_REDIS_URL` against local Redis.

## Risks

- PG outage with `DATABASE_URL` set → auth 503s; documented (next: Redis key cache).
- Clock skew on grace windows → DB `now()` used for comparisons.
