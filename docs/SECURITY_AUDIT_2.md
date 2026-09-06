# InferGate Security Re-Audit 2 (delta only)

Scope: read-only review of changed files listed in task. Date: 2026-09-06.

## R1 — Embeddings bypass quota and usage entirely (High)
`apps/gateway/src/routes/v1/embeddings.ts:31-60`, `apps/gateway/src/middleware/quota.ts:14`
Exploit: `SPEND_PREFIXES=["/v1/chat/"]` so `POST /v1/embeddings` never hits quota; handler does no `usage.insert`/`periodUsage`. Any `chat:write` key gets unmetered compute (up to 64×8000-char inputs/req) and unlimited calls within rate limit.
Fix: include `/v1/embeddings` in spend paths, record token usage, enforce quota.

## R2 — Any `keys:write` key can set org plan to enterprise (High)
`apps/gateway/src/routes/v1/billing.ts:59-80`
Exploit: `POST /v1/org/plan {"plan":"enterprise"}` needs only `keys:write`; no owner/admin check. Member key escalates own org quotas, or drops to `free` to DoS sibling keys.
Fix: require admin scope/role for plan change; audit-log transitions.

## R3 — `response_body TEXT` unbounded + unsafe replay (High)
`packages/db/migrations/0003_response_body.sql:1`, `packages/db/src/stores.ts:213-224`, `apps/gateway/src/routes/v1/chat.ts:193-195,256-267`
Exploit: full completion stored per request, no cap → table/heap growth. `JSON.parse(prior.responseBody)` unguarded (500 on corrupt row); replay keyed only on `idempotency_key`, not request hash → wrong/stale answers, quota bypass; stored model output → stored-XSS if rendered as HTML.
Fix: cap `responseBody` (16–64KB), guard parse, bind idempotency to request hash.

## R4 — Key-cache revocation window (Medium)
`apps/gateway/src/lib/keycache.ts:30-86`
Exploit: local+Redis TTL 30s; `scheduleRevoke(at>now)` skips `invalidate`. `revoke` needs `findById` first; pre-revoke reads serve stale 30s.
Fix: invalidate on schedule + recheck at `at`; negative-cache revocations.

## R5 — Rule-cache staleness across replicas/global rules (Medium)
`apps/gateway/src/lib/rules.ts:19-41,61-66`
Exploit: 30s per-process TTL, `add/remove` only clears local instance; global (`org_id IS NULL`) rule edits invalidate just one org. Revoked/expensive-model rules still route up to TTL per replica.
Fix: version/bust via Redis pub/sub or shorten TTL; invalidate all affected orgs on global change.

## R6 — `quota.exceeded` emits on every blocked request; warnings re-fire per replica/restart (Medium)
`apps/gateway/src/middleware/quota.ts:57-89`, `apps/gateway/src/lib/webhooks.ts:90-106`
Exploit: over-quota spam → webhook flood against victim URL (no dedupe/throttle). `warned` map is per-process; N replicas × restarts re-emit `quota.warning`.
Fix: dedupe exceeded per org/minute, centralize warned flag in Redis.

## R7 — Deliveries endpoint returns full webhook URLs (Medium)
`apps/gateway/src/lib/webhooks.ts:78-110`, `apps/gateway/src/routes/v1/webhooks.ts:75-81`
Exploit: `GET /v1/webhooks/deliveries` (any `keys:write` key) returns stored `url`s; secrets in query strings leak. Log is global 50-entry (cross-org eviction).
Fix: redact URLs (host+path only), per-org capped logs, narrower scope.

## R8 — Write-ahead `begin/finish` races (Medium)
`packages/db/src/stores.ts:191-224`, `apps/gateway/src/routes/v1/chat.ts:197-202,367-375`
Exploit: stale `started` rows (>5min) adoptable by same-key retry; concurrent adopters last-write-win. `finish WHERE id=` lacks `org_id`; `MemoryUsageStore.begin` check-then-insert dupes; orphans never GC'd.
Fix: `finish WHERE id AND org_id AND status='started'`, single-claimer update, GC job.

Live keys (`providers/src/index.ts:93-130`, `http.ts:60,201,249`) header-only; `app.ts:72` logs names only — no leak.
