# Security (shipped baseline; beyond Phase 1)

- API secrets stored as HMAC-SHA256 (`salt:secret` keyed by server pepper `API_KEY_PEPPER`, per-key random 16-byte salt, versioned via `PEPPER_VERSION` with rotation-tolerant verify); prefix indexed, secret never logged.
- Constant-time comparison (`timingSafeEqual`) on key and webhook-signature verify; rotation with 24h dual-accept grace; revocation immediate with key-cache invalidation (local + Redis `key:prefix:*` delete on save/revoke).
- Key cache: 30s TTL (local map cap 5000 + Redis); Redis errors fall back to inner PG/memory store — stale reads bounded by TTL, writes always invalidate.
- Org scoping enforced per query (`org_id` from verified key, never from body); per-route scope checks (`chat:write`, `models:read`, `usage:read`, `billing:read`, `keys:write`), no escalation on mint (requested scopes intersected with caller scopes).
- Zod validation on all inputs; body limit via `BODY_LIMIT_BYTES` (default 1MB); no dynamic SQL (Drizzle/`postgres` parameterized; UUID-guarded `findById`/rule delete).
- SSRF: provider egress (`assertEgressAllowed`) — https-only (http loopback only in non-prod), `PROVIDER_ALLOWLIST` (default `api.openai.com,api.anthropic.com`, wildcard `*.` supported), no creds in URL, no custom ports, private/loopback/link-local/metadata IPs blocked including hex/octal/decimal IPv4 tricks and IPv6 (`::1`, `fe80::`, `fc/fd`, mapped `::ffff:`); misconfigured live base URLs are rejected at startup (`live_provider_rejected`). Webhook URLs guarded separately (`assertWebhookUrl`, 400 `url_denied`): https-only (http loopback only when `NODE_ENV != production`), private targets blocked in production, secret min 16 chars, secrets never returned in list responses.
- Webhooks signed HMAC-SHA256 (`x-infergate-signature`), 5s delivery timeout, retries at 1s/5s/30s.
- Rate limit per key+path token bucket (`RedisTokenBucket` when `REDIS_URL` set, else in-memory); 429 `rate_limited` with `Retry-After`; fail-closed option via `RATE_LIMIT_FAIL_OPEN=false` (503 `limiter_unavailable`).
- `GET /metrics` guarded by `METRICS_TOKEN` when set (`Authorization: Bearer <token>`, 403 `forbidden`); unguarded when unset — set it in production.
- Secrets via env/K8s Secrets only (`API_KEY_PEPPER` ≥16 chars required at boot); never in repo. CORS allowlist (`ALLOWED_ORIGINS`). Structured logs redact `authorization`.
- See SECURITY_AUDIT.md (Phase 8) for full audit.
