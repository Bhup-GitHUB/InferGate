# Security Audit 3 — Final Sweep (newest surfaces)

Scope: `routes/v1/keys.ts`, `middleware/ratelimit.ts`, `routes/v1/chat.ts` (flights/replay/execSignal), `lib/keycache.ts`, `lib/audit.ts` + callers, `middleware/tracing.ts`, `lib/telemetry.ts`, migrations 0006–0008, `apps/web/app`.

## Verdicts

**Tier privilege — 1 real bug.** Create gates `plus`/`scale` behind `admin:write` (keys.ts:73-76) and scopes can't escalate (`canGrant`). But `POST /keys/:id/rotate` (keys.ts:117) calls `generateKey` without `tier`, resetting plus/scale keys to `standard` — silent downgrade + 5–20x rate-limit cliff. List endpoint also omits `tier`, so the console can't detect it. No cross-org issue: rotate checks `orgId`, plan change (`billing.ts:69-90`) requires `admin:write` and writes only `auth.orgId`.

**Replay envelope — sound.** Non-stream replay requires `safeEnvelope` + `h === requestHash(model, messages, maxTokens, temperature)` (chat.ts:222-227), 64 KB cap, stale-`started` adoption only after 5 min. Streams never replay bodies (409 only). Hash covers `req.model` alias, matching stored envelope construction. No trust bypass.

**Touch amplification — mitigated, 1 leak.** `keycache.ts:93-100` throttles DB touches to 1/min/key and swallows errors. But `touched` map has no eviction (unlike `local`'s 5000 cap) — unbounded growth with many key IDs.

**Drain — verified, no bypass.** `tracingMiddleware` runs first (`app.ts:142`), 503s every non-`/healthz` path while draining, so new streams are refused. In-flight streams hold `inflightRequests` via `await next()` through `streamSSE`. Minor: `/readyz` and `/metrics` also 503 during drain.

**OTLP SSRF — none.** Endpoint comes only from `OTEL_EXPORTER_OTLP_ENDPOINT` env, exporter-only, no user input (telemetry.ts:5-14). Webhook `fetch` is the only server-side fetch to user URLs and is guarded by `assertWebhookUrl` (private-range denial in production).

**Migrations — clean.** 0001–0008 sequential, no gaps; 0007 `tier NOT NULL DEFAULT 'standard'` is backfill-safe; 0008 `last_used_at` nullable.

**Console — no XSS sink, 1 retention issue.** No `dangerouslySetInnerHTML`. API key in `localStorage` (`lib/api.ts:18-27`) is XSS-readable but disclosed in UI ("stay in your browser"). `keys/page.tsx:51-61` retains created/rotated secrets in React state indefinitely with no clear/dismiss.

**Audit — org-scoped, fail-silent.** All `audit.record` calls pass `auth.orgId` and `.catch(() => undefined)`; lossy under DB outage but never blocks. `recent` limit clamped 1–100.

## Top 3
1. Rotate drops tier → silent plus/scale→standard downgrade (keys.ts:117). Pass `existing.tier` through and expose `tier` in list.
2. Created/rotated secrets retained in page state forever (keys/page.tsx). Clear after copy/dismiss; consider session-only display.
3. Unbounded `touched` map in `CachedKeyStore` (keycache.ts:15). Add LRU/TTL eviction like `local`.
