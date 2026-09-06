# Multi-Region Plan

Status: design doc, not yet implemented. Single-region Postgres+Redis is
the current milestone; this records the decisions so the build stays
compatible.

## Topology

Active-active gateway pods per region (stateless, Helm chart already
parameterized). One primary Postgres with async read replicas per region;
writes (keys, usage, rules, webhooks) go to primary, reads prefer replica
with primary fallback. Redis: one global control plane is a latency trap —
run regional Redis for rate limits/cache/breakers, accept per-region
quotas, reconcile spend from PG `requests` (source of truth, already
write-ahead).

## Routing

Keep latency strategy region-aware: EWMA inputs already flow through the
shared `provider:ewma` hash — namespace it per region
(`provider:ewma:{region}`) and add provider region affinity in
`routing_rules.config`. Breaker flags stay regional; a provider outage in
one region must not drain others.

## Keys and trust

Peppers distribute via regional secret managers (never replicate the
value through app config). `pepper_version` already supports rotation.
API key hashes replicate with PG; 30s key cache absorbs replica lag.
Revocation converges in ≤30s — document it in the enterprise SLA.

## Data residency

`requests.response_body` is the only bulky customer payload: partition by
region (`region` column, default `home`), pin EU orgs to EU DB. Billing
rollups stay regional, invoices consolidate centrally.

## What to build first

1. `region` column + read/write split in `createSql`.
2. Regionalize Redis key namespaces.
3. Cross-region usage rollup job.
4. Latency-based DNS (GeoDNS) + per-region `/readyz` for failover.
