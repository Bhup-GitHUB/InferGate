# Billing Plan (Phase 3)

## Problem

Usage rows exist but nothing enforces spend or exposes billing. Need quotas that reject over-limit traffic, daily usage breakdowns, and a billing summary with invoice drafts so orgs can see and control cost.

## Proposed solution

New `packages/billing`: plan caps (free/pro/enterprise monthly token + spend caps), quota checks against `UsageStore` aggregates, rollup helper turning usage rows into daily buckets, invoice draft builder. Gateway: quota middleware on `/v1/chat/completions` (402 `quota_exceeded` when over), `GET /v1/usage/daily?days=30`, `GET /v1/billing/summary` (current period spend, quota, invoice draft).

## Architecture changes

- New `packages/billing/src/{plans.ts,quota.ts,rollup.ts}`.
- UsageStore gains `recordsByOrg(orgId, sinceMs)` for rollups; MemoryUsageStore implements it.
- Quota check runs after auth, before provider call; counts only `ok` rows in current calendar month (UTC).

## Database changes

None. Reads existing `requests` rows; `usage_daily`/`invoices` writes land with PG worker in Phase 4.

## API changes

- `GET /v1/usage/daily?days=7` → `{ days: [{ date, requests, inputTokens, outputTokens, costUsd }] }` (requires `usage:read`).
- `GET /v1/billing/summary` → `{ plan, period, spendUsd, quotaUsd, tokensUsed, tokenQuota, invoice: { amountUsd, status } }` (requires `billing:read`).
- Quota breach → 402 `{ error: { code: quota_exceeded } }` with `Retry-After` unset (monthly reset in message).

## Security considerations

- Org scoping from auth context; plan map server-side; no client-settable caps.
- Quota decisions logged; fail-closed on store errors for writes, fail-open for reads restores availability.

## Scalability considerations

- Aggregation is O(rows in window) in-memory Phase 3; PG `GROUP BY` + `usage_daily` rollups in Phase 4 behind the same interfaces.

## Testing approach

Unit: quota allow/deny boundaries, rollup bucketing, invoice math. Integration: seed usage over cap → 402; daily endpoint shape; summary math matches inserted rows.

## Risks

- In-memory aggregates diverge across pods → accepted Phase 3, Redis counters Phase 4.
- Month-boundary races → UTC month key, documented.
