# API Design (OpenAI-compatible)

## Auth

`Authorization: Bearer ig_sk_<prefix>_<secret>`. 401 `invalid_api_key` on miss. Key mgmt routes require `keys:write` scope.

## Endpoints

### POST /v1/chat/completions

Request:
```json
{ "model": "auto", "messages": [{"role":"user","content":"Explain Kubernetes"}], "stream": true, "max_tokens": 512, "temperature": 0.7 }
```

Extension fields (stripped before the provider call): `idempotency_key`
(409 on replay, scoped per org), `cache_ttl` (1..3600s, non-stream only,
`x-infergate-cache: HIT|MISS`, cache hits bill $0 but count quota tokens).

Non-stream response: `{ "id": "chatcmpl-...", "object": "chat.completion", "model": "...", "choices": [{"message": {"role":"assistant","content":"..."}, "finish_reason":"stop", "index":0}], "usage": {"prompt_tokens":N,"completion_tokens":M,"total_tokens":T} }`

Stream: `Content-Type: text/event-stream`, frames `data: {"id":...,"choices":[{"delta":{"content":"..."},"index":0}]}` … `data: [DONE]`.

Errors (OpenAI shape): `{ "error": { "message": "...", "type": "invalid_request_error|authentication_error|rate_limit_error|provider_error", "code": "..." } }` with 400/401/429/502.

Headers: `x-infergate-provider`, `x-infergate-retry`, `x-request-id`.

### GET /v1/models

`{ "object":"list", "data": [{"id":"gpt-4o-mini","object":"model","owned_by":"openai"}] }`

### POST /v1/keys/:id/rotate

Creates successor key, 24h dual-accept grace. Requires `keys:write`.

### POST /v1/keys

Mints a key for the caller org. Requested scopes are intersected with the
caller scopes (no escalation). Returns the secret once. Requires `keys:write`.

### GET /v1/usage · GET /v1/usage/daily?days=7 · GET /v1/requests?limit=25

Usage summary, daily rollup (1..90 days), recent request feed.
Require `usage:read`.

### GET /v1/billing/summary

Plan, UTC-month spend/tokens vs caps, invoice draft. Requires `billing:read`.
Over-quota chat requests get 402 `quota_exceeded` (and emit the webhook).

### GET /v1/routing/health

Per-provider circuit state, EWMA latency, error rate. Requires `models:read`.

### Webhooks

`POST /v1/webhooks {url, secret, events}` · `GET /v1/webhooks` (secrets
never returned) · `DELETE /v1/webhooks/:id`. Require `keys:write`. Events:
`quota.exceeded`, `provider.outage` (+`quota.warning` reserved), HMAC-SHA256
in `x-infergate-signature`, retries at 1s/5s/30s.

### Scheduler

`POST /v1/scheduler/placement {nodes, models}` → bin-packed placements +
utilization. `GET /v1/scheduler/demo` → canned A100x4 + H100x8 fleet.
Require `models:read`.

## Validation

Zod strict: `model` required string, `messages` min 1 with valid roles, `max_tokens` 1..128k, `temperature` 0..2. Unknown models → 400 `model_not_found` unless `auto`.
