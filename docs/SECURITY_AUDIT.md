# InferGate External Security Audit

Auditor role: outside security firm. Scope is read-only review of gateway, shared packages, web console, Helm chart, and stated security baseline. No code was changed for this report. Audit date: 2026-09-05. Repository state as found on disk.

Method: manual review of `apps/gateway/src`, `packages/*/src`, `apps/web/lib` plus `apps/web/app` pages and components, `deployments/helm`, and `docs/SECURITY.md`. Each finding was traced to concrete lines. Exploit sketches are conceptual and safe to reproduce in a staging environment only.

---

## F1 — Production falls back to a public dev pepper

Severity: Critical

Location: `apps/gateway/src/lib/config.ts:18-26`

Exploit sketch: deploy the Helm chart or any host without setting `API_KEY_PEPPER` and without `NODE_ENV=production`. The gateway boots with `dev-pepper-change-in-production`. An attacker who obtains the database (backup, snapshot, SQL injection elsewhere, insider) recomputes `HMAC-SHA256` for every row with the known pepper and recovers usable API secrets offline, then calls the production gateway.

Observed behavior:

```
POST /v1/chat/completions
Authorization: Bearer ig_sk_recoveredsecret
```

Recommended fix: fail closed whenever `API_KEY_PEPPER` is empty regardless of `NODE_ENV`, enforce a minimum pepper strength at boot, and add a startup self-test that refuses to serve traffic when the pepper matches any known default.

---

## F2 — Key minting allows scope escalation

Severity: High

Location: `apps/gateway/src/routes/v1/keys.ts:22-32`

Exploit sketch: hold a key with only `keys:write` plus a low-value scope. Call `POST /v1/keys` requesting `billing:read` or any other scope in the allowlist. The handler filters the request against a static allowlist but never checks that the requested set is a subset of the caller scope set, so the new key gains scopes the caller never had. Repeat to manufacture an all-powerful key from a narrow minting key.

Observed behavior:

```
POST /v1/keys
Authorization: Bearer ig_sk_narrowkey
{"scopes": ["billing:read", "chat:write"]}
```

Response returns a key with scopes the caller lacked.

Recommended fix: intersect requested scopes with the authenticated caller scopes, reject any request that asks for a scope the caller does not hold, and consider splitting key administration into its own admin scope rather than reusing `keys:write`.

---

## F3 — Provider allowlist is declared but never enforced, localhost is trusted

Severity: High

Location: `apps/gateway/src/lib/config.ts:36`, `packages/db/src/schema.ts:52-58`, `packages/db/migrations/0001_foundation.sql:106-109`

Exploit sketch: the docs claim `PROVIDER_ALLOWLIST` constrains outbound provider fetches, but no gateway or provider module references the configured list. The only provider addresses live in the `providers.base_url` column, seeded with `http://localhost:8000`. When a real HTTP adapter is added that trusts that column, anyone who can influence provider rows, seed data, or a future admin endpoint can point the gateway at link-local addresses and exfiltrate cloud metadata or reach internal services through the gateway egress identity.

Recommended fix: implement a single egress helper that validates every outbound host against the allowlist, blocks loopback and link-local ranges unless an explicit development flag is set, pins scheme to HTTPS outside development, and fails closed on allowlist parse errors. Remove `localhost` from the production default.

---

## F4 — Idempotency uniqueness is global in SQL but per-org in code

Severity: High

Location: `packages/db/migrations/0001_foundation.sql:70`, `apps/gateway/src/lib/store.ts:92-93`, `apps/gateway/src/routes/v1/chat.ts:83-92`

Exploit sketch: org A sends `idempotency_key` equal to `victim-key-1` once. Org B later sends the same string. The in-memory store isolates by `orgId` and would allow it, but the Postgres table declares `idempotency_key TEXT UNIQUE` globally, so org B receives a constraint violation or 500. This is a cross-tenant denial primitive and, where database errors surface, an existence oracle for another tenant key space.

Recommended fix: replace the global unique constraint with a composite unique key on tenant plus idempotency key, backfill existing duplicates, and return a deterministic conflict response that does not reveal which tenant owns the key.

---

## F5 — Helm ships guessable secret defaults and silent Redis downgrade

Severity: High

Location: `deployments/helm/infergate/values.yaml:21-24`, `deployments/helm/infergate/templates/service.yaml:32-40`, `apps/gateway/src/app.ts:54-59`

Exploit sketch: install the chart without overriding `secrets.apiKeyPepper` or `secrets.databaseUrl`. Every install shares `CHANGEME`. The empty `redisUrl` default also disables shared rate limiting and shared caching without warning, silently reducing the deployment to per-pod memory controls. An attacker who guesses the default pepper and obtains a database copy forges valid keys.

Observed behavior: fresh `helm install` boots successfully with placeholder secrets.

Recommended fix: remove default secret values, mark them required, fail template rendering when unset, integrate external secret management, and fail boot or emit a blocking warning when Redis is disabled in production.

---

## F6 — Rate limiting multiplies by keys, paths, and replicas

Severity: High

Location: `apps/gateway/src/middleware/ratelimit.ts:9-10`, `packages/ratelimit/src/index.ts:16-40`, `packages/cache/src/limiter.ts:27-51`, `apps/gateway/src/app.ts:54-59`

Exploit sketch: the bucket key is per key plus per path, not per org plus model as documented. An attacker mints N keys through F2, spreads calls across chat, models, usage, billing, and routing paths, and sprays across 3 or more replicas that each hold an independent memory bucket when Redis is unset. Effective throughput scales as keys times paths times replicas. The memory bucket map also never evicts entries, so a key-spray attack grows server memory.

Observed behavior:

```
GET /v1/models
GET /v1/usage
GET /v1/routing/health
```

Each path draws from a separate bucket for the same identity.

Recommended fix: key limits by tenant and model class in shared Redis, enforce a global per-tenant bucket in addition to per-key buckets, bound the in-memory fallback with LRU eviction, and reconcile documentation with the implemented keying.

---

## F7 — Quota is pre-check only, cached completions skip spend accounting

Severity: Medium

Location: `apps/gateway/src/middleware/quota.ts:13-19`, `apps/gateway/src/routes/v1/chat.ts:115-152`, `apps/gateway/src/routes/v1/chat.ts:122-134`

Exploit sketch: pass quota with one token remaining, then request a large `max_tokens` completion. The middleware allows the request because usage is under quota at entry, and the non-streaming path performs no mid-flight or post-flight quota recheck before recording usage. Separately, repeat a cacheable prompt with `cache_ttl` set. Cache hits record `costUsd: 0`, so spend quota never advances while token quota advances only by the cached token counts, letting an attacker stretch a spend budget with replayed premium answers.

Recommended fix: reserve an estimated maximum cost at admission, reconcile actual cost after completion, apply spend accounting to cache hits or exclude cached tokens explicitly by policy, and enforce a hard post-request quota check with compensating action.

---

## F8 — Streaming quota guard relies on a character-length heuristic

Severity: Medium

Location: `apps/gateway/src/routes/v1/chat.ts:277-279`, `apps/gateway/src/routes/v1/chat.ts:370-375`

Exploit sketch: stream a completion whose real tokenizer count far exceeds `content.length / 4`, for example with multibyte text or dense token sequences. The in-stream guard compares the heuristic estimate against remaining quota and aborts late or never, allowing quota overrun within a single long stream before the final usage row is written.

Recommended fix: replace the heuristic with tokenizer-aware accounting from provider usage deltas, enforce periodic server-side usage reconciliation during streams, and terminate the stream as soon as authoritative usage exceeds quota.

---

## F9 — Unauthenticated observability and readiness endpoints

Severity: Medium

Location: `apps/gateway/src/app.ts:67-91`

Exploit sketch: call `GET /metrics` without credentials to harvest per-provider request counts, token totals, and error counters for business-intelligence and timing attacks. Call `GET /readyz` repeatedly to force the gateway to run upstream health checks on every scrape, amplifying a cheap anonymous request into multiple provider calls.

Observed behavior:

```
GET /metrics
GET /readyz
```

Both succeed without an API key.

Recommended fix: require authentication or network-level restriction for metrics and readiness detail, split liveness from deep readiness, cache readiness results with a short TTL, and strip per-tenant or cost-sensitive labels from any unauthenticated endpoint.

---

## F10 — Web console keeps API keys in localStorage with no content policy

Severity: Medium

Location: `apps/web/lib/api.ts:14-27`, `apps/web/next.config.mjs:1-4`, `apps/web/components/KeyGate.tsx:30-36`

Exploit sketch: inject or lure any cross-site script into the console origin. The script reads `window.localStorage.getItem("infergate_key")` and exfiltrates a long-lived gateway key. There is no content security policy, and key material persists across sessions in readable JavaScript storage.

Recommended fix: move to a short-lived session credential held server-side or in memory only, add a strict content security policy and trusted-types policy, scope keys narrowly for browser use, and provide explicit key-revocation guidance in the console.

---

## F11 — Helm workload lacks hardening, network, and transport controls

Severity: Medium

Location: `deployments/helm/infergate/templates/deployment.yaml:17-67`, `deployments/helm/infergate/values.yaml:1-28`

Exploit sketch: compromise one container process and find no `runAsNonRoot`, read-only filesystem, privilege-escalation guard, resource ceiling beyond generous defaults, network policy, pod disruption budget, or TLS termination guidance. Lateral movement and traffic interception are easier than necessary for an edge AI gateway.

Recommended fix: add a restrictive security context, read-only root filesystem, explicit resource quotas, network policies that allow only gateway, database, and Redis flows, and documented TLS termination with HSTS at ingress.

---

## F12 — CORS policy is centrally configured but fragile

Severity: Medium

Location: `apps/gateway/src/app.ts:64`, `apps/gateway/src/lib/config.ts:37`

Exploit sketch: an operator sets `ALLOWED_ORIGINS` to a wildcard or a comma-joined string with stray whitespace to onboard a new frontend quickly. Browsers then allow an attacker origin to make credentialed or key-bearing reads through the victim browser, or legitimate browser clients break because `Authorization` is not explicitly in the allowed-headers contract. The current default is narrow, but the failure mode on misconfiguration is open.

Recommended fix: validate origins strictly at boot, reject wildcards in production, normalize and trim entries, explicitly enumerate allowed methods and headers including `Authorization` and `Content-Type`, and add regression tests for wildcard and suffix-match rejection.

---

## F13 — Idempotency guard is per-process and leaks existence

Severity: Medium

Location: `apps/gateway/src/routes/v1/chat.ts:55-93`

Exploit sketch: send two identical `idempotency_key` requests concurrently to different replicas. Each replica holds its own `inflight` set and its own usage view, so both execute and both bill. Separately, probe candidate keys within the same org: `409` means the key was already used, `200` means it was fresh, giving an intra-org activity oracle.

Recommended fix: move idempotency claim to an atomic shared operation in Redis or Postgres with insert-if-absent semantics, return the original result reference instead of a bare conflict where appropriate, and normalize timing of conflict responses.

---

## F14 — Response cache enables same-org poisoning and stale replay

Severity: Medium

Location: `packages/cache/src/responseCache.ts:13-44`, `apps/gateway/src/routes/v1/chat.ts:117-152`, `packages/schemas/src/index.ts:11-20`

Exploit sketch: within one org, submit a cacheable prompt with attacker-chosen context and `cache_ttl` up to 3600. A victim in the same org who submits the same model, messages, `max_tokens`, and temperature receives the attacker-influenced cached answer with an `HIT` header. Because TTL is client-controlled, stale or previously correct answers persist longer than operators expect.

Recommended fix: bind cache keys to the calling principal or an explicit sharing scope rather than org alone, authenticate cache writes, cap client TTL server-side, add cache-poisoning tests, and consider disabling cache for authenticated or privileged contexts by default.

---

## F15 — Routing and cache headers expose internals on every response

Severity: Low

Location: `apps/gateway/src/routes/v1/chat.ts:135-137`, `apps/gateway/src/routes/v1/chat.ts:200-201`, `apps/gateway/src/routes/v1/chat.ts:342-345`

Exploit sketch: collect `x-infergate-provider`, `x-infergate-retry`, `x-infergate-cache`, and the `infergate.route` SSE event across many requests. The values fingerprint provider health, failover behavior, and cache state, helping an attacker time cache-busting, provider-targeted, or cost-amplification attacks.

Recommended fix: gate verbose routing headers behind a debug scope or remove them from external responses, keep minimal cache status for operability, and document the remaining header contract.

---

## F16 — Pepper rotation accepts any configured pepper

Severity: Low

Location: `packages/auth/src/index.ts:99-117`, `apps/gateway/src/middleware/auth.ts:29-30`

Exploit sketch: compromise a retired pepper. Because verification loops over every pepper in the map rather than only the version recorded on the key, secrets hashed under the retired pepper continue to verify indefinitely while that pepper remains configured. The fallback lookup on the middleware side is redundant but harmless beside the loop.

Recommended fix: verify against the recorded `pepperVersion` first, allow fallback to older peppers only during a bounded migration window with alerting, and remove retired peppers on a schedule.

---

## F17 — Seed key handling risks secret-bearing logs

Severity: Low

Location: `apps/gateway/src/index.ts:9-23`

Exploit sketch: enable `PRINT_SEED_KEY=1` in a deployed environment to debug onboarding. The full gateway key is written to stderr, where container log collectors, crash dumps, and support bundles retain it far longer than intended. The boot log also emits org and prefix metadata on every restart.

Recommended fix: never print full keys outside local development, gate seeding behind an explicit bootstrap command, emit only prefix and key identifier in production logs, and rotate any seed key that was ever logged.

---

## F18 — In-memory limiter state grows without bound

Severity: Low

Location: `packages/ratelimit/src/index.ts:16-40`

Exploit sketch: iterate random key identifiers or, where unauthenticated paths consult the limiter, random forwarded identities. Each distinct bucket key allocates a map entry that is never expired, slowly increasing heap usage until garbage-collection pressure or out-of-memory restart.

Recommended fix: add TTL and LRU eviction for idle buckets, cap total bucket count, and prefer shared Redis accounting in multi-replica deployments.

---

## F19 — Structured logging and metrics escaping is incomplete

Severity: Low

Location: `packages/otel/src/index.ts:58-86`, `apps/gateway/src/middleware/tracing.ts:5-22`

Exploit sketch: submit paths or model aliases containing control characters, quotes, or newlines where validation is looser, such as future admin routes. Path values flow into JSON logs safely through `JSON.stringify`, but Prometheus label escaping handles only backslash and quote, leaving newline and control-character handling to downstream scrapers and dashboards where log-forging or metric-splitting artifacts appear.

Recommended fix: sanitize all values when rendering Prometheus exposition, validate and normalize path and label inputs, and add tests that submit newline, quote, and control-character payloads through logging and metrics paths.

---

## F20 — Dependency and framework version skew

Severity: Low

Location: `package.json:17-34`, `apps/web/package.json:10-14`

Exploit sketch: the root manifest allows Next `^16.3.4` while the web app pins Next `15.1.6`, alongside caret ranges for Hono, ioredis, Zod v4, drizzle, and Postgres. Mixed major versions and floating ranges increase the chance that a fresh install pulls an untested combination or a compromised minor release without a lockfile and advisory review gate catching it.

Recommended fix: align on one supported Next and React lineage, pin or lock production images to reviewed digests, enable automated vulnerability scanning and Dependabot-style updates, and record the review cadence for AI-gateway-critical dependencies.

---

## Risk summary

The highest immediate risk is credential-equivalent material: a known dev pepper, placeholder Helm secrets, and an overly powerful key-minting endpoint. Together these make database or log exposure much more damaging than the baseline document suggests. The next tier is tenant and budget isolation: global idempotency uniqueness, per-process rate and idempotency state, pre-check-only quota, and client-influenced caching each allow cross-request, cross-replica, or cross-principal bypass. Observability sharpens the impact by exposing traffic, provider, cache, and readiness behavior to unauthenticated callers. Web and Helm hardening gaps then widen blast radius after any initial compromise. None of the reviewed routes showed direct unauthenticated access to chat, models, usage, billing, keys, or routing data, and org scoping on those routes was consistently taken from the verified key rather than request bodies.

## Prioritized fix list

1. Fail closed on missing or default `API_KEY_PEPPER` and remove Helm `CHANGEME` defaults.
2. Require requested key scopes to be a subset of caller scopes.
3. Replace global idempotency uniqueness with a per-tenant constraint and atomic claim.
4. Move rate limiting and idempotency to shared Redis with tenant-level buckets and bounded memory fallback.
5. Enforce the provider allowlist in a single egress helper and remove loopback trust from production defaults.
6. Convert quota to reserve-and-reconcile with tokenizer-aware streaming guards and spend-aware cache accounting.
7. Authenticate or restrict metrics and deep readiness, and cache readiness results.
8. Harden the web console credential lifecycle and add a strict content security policy.
9. Scope response caching explicitly, cap client TTL server-side, and add poisoning tests.
10. Harden Helm with security context, network policy, TLS guidance, and required secrets management.
11. Reduce header and SSE internal disclosure to the minimum operational set.
12. Bound pepper-rotation fallback, stop printing seed secrets, bound limiter memory, tighten metric escaping, and align dependencies with scanning.
