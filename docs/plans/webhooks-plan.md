# Webhooks Plan — Usage Alerts

## Problem

Orgs have no push signal for spend and reliability risk. They discover quota breaches via failed requests (402/429) and provider outages via elevated errors. Billing rollups and usage endpoints require polling. High-spend orgs need proactive alerts at 80% and 100% of quota, plus outage notices when a provider degrades, so they can throttle, top up, or fail over before users are impacted.

## Solution

Org-scoped webhook endpoints subscribed to usage events. Billing and routing emit domain events (`quota.warning`, `quota.exceeded`, `provider.outage`). A webhook dispatcher fans out HMAC-signed POST deliveries per subscription with bounded retries and exponential-ish backoff. Delivery state and attempts are observable via API and logs. No polling required by consumers.

## Events

| Type | Trigger | Payload `data` |
|---|---|---|
| `quota.warning` | Org crosses 80% of monthly token or spend cap | `{ plan, tokensUsed, tokenLimit, spendUsd, spendLimit, percentUsed }` |
| `quota.exceeded` | Request denied with `quota_exceeded` (402) | `{ plan, tokensUsed, tokenLimit, spendUsd, spendLimit, deniedAt }` |
| `provider.outage` | Consecutive provider failures cross threshold or circuit opens | `{ providerId, consecutiveFailures, openedAt, affectedModels }` |

Envelope for every delivery:

```json
{
  "id": "evt_... (uuid)",
  "type": "quota.warning",
  "orgId": "org_123",
  "data": {},
  "occurredAt": "2026-09-05T00:00:00.000Z"
}
```

## API Design

- `POST /v1/webhooks` — body `{ url: string (https), secret?: string, events: EventType[] }`. Returns `{ id, url, events, createdAt }`. Server generates a signing secret when omitted and returns it once.
- `GET /v1/webhooks` — list org endpoints `{ id, url, events, createdAt, lastDeliveryAt, lastStatus }`.
- `DELETE /v1/webhooks/:id` — remove endpoint.
- `GET /v1/webhooks/:id/deliveries` — recent attempts `{ eventId, type, status, attempts, nextRetryAt, lastError }`.
- Auth: org API key with `webhooks:write` / `webhooks:read` scopes. `orgId` derived from key, never from body.

Delivery request:

- `POST {url}` with headers `content-type: application/json`, `x-infergate-event: <type>`, `x-infergate-delivery: <delivery id>`, `x-infergate-signature: <hex HMAC-SHA256 of raw body>`, `x-infergate-timestamp: <unix ms>`.
- Timeout 10s per attempt. Attempts: initial + 3 retries at delays `[1000, 5000, 30000]` ms.
- Retry on network error, timeout, or 5xx / 429. No retry on other 4xx. Optional `Retry-After` honored when present.

## Security

- Per-endpoint secret, stored hashed (HMAC key derivation, same pattern as API keys) with only the plaintext returned once at creation.
- HMAC-SHA256 hex over raw request body, verified by receivers; dispatcher uses timing-safe comparison internally for tests and receipt endpoints.
- HTTPS-only URLs; reject localhost / private-range targets except in development with explicit env flag.
- Timestamp header with ±5 minute skew rejection to block replays; delivery IDs idempotent for deduplication.
- Secrets rotatable via `POST /v1/webhooks/:id/rotate`; old secret valid for a short grace window.
- Minimal payload: no API keys, no raw prompts; only aggregate usage counters and outage metadata.

## Testing

- Unit: `sign` / `verify` roundtrip, tampered payload or wrong secret fails, `buildEvent` envelope shape, `WebhookQueue.due` filters by subscribed event type, `retryDelays` equals `[1000, 5000, 30000]`.
- Contract: dispatch to local HTTP stub asserts headers, signature recomputation, and retry counts on 500 then 200.
- Integration: force quota breach in gateway test app, assert webhook delivery enqueued for `quota.exceeded`; simulate provider circuit open, assert `provider.outage` delivery.
- Load: 1k subscriptions fan-out under quota breach completes without blocking chat path (async dispatch).

## Risks

- Retry storms against a down receiver amplify load → cap attempts at 4 total, jitter delays, per-host concurrency limit, circuit-break delivery per endpoint after sustained failures.
- Secret leak via logs → never log raw body with signature or plaintext secrets; store hashes only.
- Slow receivers block dispatch loop → async queue with persistence; chat path never awaits delivery.
- Event spam at threshold boundary → emit `quota.warning` once per org per month (dedupe key `orgId:month:warning`); `quota.exceeded` rate-limited per org per minute.
- SSRF via attacker-controlled URL → validate scheme/host, deny private IPs via DNS resolution check at registration and before each delivery batch.
