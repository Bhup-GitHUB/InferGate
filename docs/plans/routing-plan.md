# Routing Engine Plan (Phase 2)

## Problem

Phase 1 pins each model alias to one provider with no failover. A provider outage or latency spike becomes a gateway outage. Need strategy-based provider selection with health awareness and automatic failover.

## Proposed solution

New `packages/routing` with `RoutingEngine`: candidate discovery from registry + org/global `routing_rules`, strategy scoring (cost | latency | availability | weighted | priority), `HealthTracker` (EWMA latency, error rate, consecutive failures), `CircuitBreaker` (closed → open → half-open), and `executeWithFailover` (try candidates in order, exponential backoff, abort-aware).

## Architecture changes

- New `packages/routing/src/{types.ts,engine.ts,breaker.ts,health.ts}`.
- Gateway `chat.ts` uses engine: build candidates, pick ordered list, attempt each with per-try timeout, record success/failure to tracker, set `x-infergate-retry` to attempt count, `x-infergate-provider` to winner.
- Strategies read from in-memory rules list seeded from env `DEFAULT_STRATEGY` (default `availability`); rule CRUD lands with PG-backed rules in Phase 3.

## Database changes

None. `routing_rules` table already exists; engine accepts rules as plain objects so PG wiring is additive later.

## API changes

- Response headers: `x-infergate-retry: N` reflects real attempt count.
- New `GET /v1/routing/health` returns per-provider circuit state + EWMA latency (requires `models:read`).

## Security considerations

- Rules are server-side only; no client-controlled routing input beyond `model`.
- Breaker state per process Phase 2; Redis-shared state in Phase 4 to prevent per-pod thundering.

## Scalability considerations

- Selection is O(candidates), no I/O on hot path; health updates are in-memory atomics.
- Failover bounded: max 3 attempts, backoff 50/150ms capped, total budget inside existing max-duration timeout.

## Testing approach

Unit: each strategy orders candidates correctly; breaker opens after threshold and half-opens after cooldown; EWMA updates. Integration: force primary to fail (failureRate override) and assert fallback provider serves with `x-infergate-retry: 1`.

## Risks

- Per-process breaker divergence across pods → accepted Phase 2, shared Redis state Phase 4.
- Retry storms during full outage → capped attempts + backoff + breaker.
