# Database Design

## Tables (Phase 1)

- `users(id uuid pk, email citext unique, password_hash text, created_at)`
- `organizations(id uuid pk, name text, plan text default 'free', created_at)`
- `org_members(org_id fk, user_id fk, role text, pk(org_id,user_id))`
- `api_keys(id uuid pk, org_id fk idx, prefix text unique idx, hashed_secret text, scopes text[], expires_at, rotated_from_id fk nullable, revoked_at nullable, created_at)`
- `providers(id text pk, base_url text, kind text, enabled bool, created_at)`
- `models(id text pk, provider_id fk, alias text unique idx, input_price_1k numeric, output_price_1k numeric, context_window int, enabled bool)`
- `routing_rules(id uuid pk, org_id fk nullable, model_alias text idx, strategy text, config jsonb, priority int, created_at)`
- `requests(id uuid pk, idempotency_key text unique nullable, org_id fk idx, key_id fk, provider_id, model, input_tokens int, output_tokens int, latency_ms int, cost_usd numeric, status text, error text nullable, created_at idx BRIN)`
- `usage_daily(org_id, date, model, input_tokens bigint, output_tokens bigint, cost_usd numeric, requests bigint, pk(org_id,date,model))`
- `invoices(id uuid pk, org_id fk, period_start date, period_end date, amount_usd numeric, status text)`

## Indexing

- `api_keys(prefix)` unique btree (hot lookup, cached in Redis 30s).
- `models(alias)` unique; `requests(org_id, created_at)` btree for usage queries; `requests(created_at)` BRIN for partition pruning.
- Partition `requests` by RANGE monthly when >10M rows (Phase 3).

## Migrations

Drizzle-kit generates plain SQL in `packages/db/migrations/`. Applied by `migrations Job` in Helm. Never hand-edit applied migrations.

## Query patterns

- Auth: `SELECT * FROM api_keys WHERE prefix=$1 AND revoked_at IS NULL` (prepared, pooled).
- Logging: batch `INSERT INTO requests (...) VALUES ...` 500/5s from billing worker.
- Billing rollup: `INSERT INTO usage_daily ... ON CONFLICT DO UPDATE` hourly from worker.
