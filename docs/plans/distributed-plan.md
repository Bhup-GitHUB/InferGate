# Distributed Systems Plan (Phase 4)

## Problem

Rate limiting, breaker state, and billing are per-process. Multi-pod deploys diverge: limits reset per pod, breakers disagree, usage lost on crash. Need Redis-backed coordination with graceful degradation when Redis is down.

## Proposed solution

New `packages/cache`: Redis client factory (lazy, `REDIS_URL`), LUA token-bucket limiter, TTL response cache (opt-in `cache_ttl` extension), `Redlock`-style distributed lock (SET NX PX + token release). Gateway: Redis limiter when `REDIS_URL` set else memory; non-stream completion cache when `cache_ttl` present; billing writes dual-path (direct insert now, stream publish when Redis present for worker drain).

## Architecture changes

- New `packages/cache/src/{client.ts,limiter.ts,responseCache.ts,locks.ts}`.
- `createRateLimiter` extended: returns Redis limiter if client provided (keep memory constructor for tests).
- Chat route: after validation, if `cache_ttl` set, hash (model+messages+params) → cache hit returns stored completion with `x-infergate-cache: HIT`; miss proceeds and stores on success.
- Billing worker: XREADGROUP drain loop when Redis present; else idle heartbeat.

## Database changes

None.

## API changes

- Extension field `cache_ttl` (seconds, 1..3600) accepted on chat requests, stripped before provider call.
- Headers `x-infergate-cache: HIT|MISS` on non-stream responses.

## Security considerations

- Cache keys include orgId (no cross-org reads); TTL bounded; no secrets cached (responses only).
- LUA scripts atomic; locks carry fencing tokens; fail-closed limiter when Redis errors and `RATE_LIMIT_FAIL_OPEN=false`.

## Scalability considerations

- Hot path adds one Redis RTT (limit) + one (cache); pipelined; local negative-cache for breaker state stays per-process (documented).

## Testing approach

Unit with mock Redis client (in-memory Map honoring TTL): limiter refill, cache HIT/MISS, lock mutual exclusion. Integration skips when `REDIS_URL` unset; CI provides Redis service.

## Risks

- Redis outage → limiter fail-open/closed per config; cache treated as miss; documented.
- Thundering herd on cache miss → lock-based single-flight for identical keys.
