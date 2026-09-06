# InferGate Chaos Testing — Live Gateway Experiments

> Update (Postgres mode): kill -9 mid-SSE now leaves a `status='started'`
> row instead of losing the request. Retry with the same idempotency key
> returns 409 while fresh (<5min, treated as in-flight); verified live:
> first request 200, replay 409.
>
> Update (replay): completed non-stream requests replay the original 200
> (hash-bound, `x-infergate-replay: true`) with a single DB row — verified
> live against Postgres.
>
> Update (fuzz): 8 malformed bodies + garbage key against live gateway →
> all 400/401, zero 5xx, zero crashes, zero error logs.

Date: 2026-09-05 (UTC)
Host: macOS, Bun 1.3.5
Repo: /Users/bhupeshkumar/Desktop/InferGate
Gateway: mock providers (openai / anthropic / local-vllm, failureRate 0), no external keys required.
Test pepper: `chaos-test-pepper-01` (throwaway; all keys below are ephemeral test credentials, servers killed after run).

## Scenario table

| # | Scenario | Target | Result |
|---|----------|--------|--------|
| 1 | Baseline: 20 non-stream chat completions | :3220 (`RATE_LIMIT_PER_MINUTE=100000`) | 20/20 HTTP 200 |
| 2 | Routing health shape (`GET /v1/routing/health`) | :3220 | 200, all circuits `closed` |
| 3 | `model=auto` routing probe | :3220 | 200, served by `anthropic` for a `gpt-4o-mini` label |
| 4 | Stream sample (SSE, happy path) | :3220 | 200, 1296 bytes, `infergate.route` + 6 chunks + `[DONE]` |
| 5 | Kill -9 gateway mid-SSE-stream | :3220 | Client: curl exit 18, truncated at 1071 bytes mid-chunk; server: process gone, `/readyz` refused (000/exit 7) |
| 6 | Restart + recovery | :3220 (new boot) | `/readyz` 200 in ~10–31 ms; 5/5 chat completions 200 |
| 7 | Rate-limit storm: 150-request burst, default 120/min | :3221 (fresh process, default limit) | 123×200, 27×429, `Retry-After: 1`, `X-RateLimit-Remaining: 0` |
| 8 | Invalid-key flood: 20 bad keys | :3220 | 20/20 HTTP 401, 0×5xx |
| 9 | Missing / malformed auth edge cases | :3220 | 401 `missing_api_key` / `invalid_api_key` |

## Commands run

### 1. Start gateway (:3220, high limit so baseline is not throttled)

```bash
API_KEY_PEPPER=chaos-test-pepper-01 PORT=3220 RATE_LIMIT_PER_MINUTE=100000 PRINT_SEED_KEY=1 \
  nohup bun run apps/gateway/src/index.ts > /tmp/chaos-gw.log 2>&1 &
```

Log output:

```text
{"ts":"2026-09-05T01:44:05.028Z","level":"info","msg":"gateway_boot","port":3220,"orgId":"org_demo"}
{"ts":"2026-09-05T01:44:05.029Z","level":"info","msg":"seed_key","prefix":"iXuyPc","orgId":"org_demo"}
SEED_API_KEY=ig_sk_iXuyPc_cC6B7nBcFbWrs1zmJw4DGUp2cC6B7nBc
Started development server: http://localhost:3220
```

### 2. Baseline: 20 chat completions

```bash
SEED="ig_sk_iXuyPc_cC6B7nBcFbWrs1zmJw4DGUp2cC6B7nBc"
for i in $(seq 1 20); do
  code=$(curl -s -o /tmp/chaos-base-$i.json -w "%{http_code}" \
    -X POST http://localhost:3220/v1/chat/completions \
    -H "Authorization: Bearer $SEED" -H "Content-Type: application/json" \
    -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"baseline ping '$i'"}]}')
  echo "req $i -> $code"
done
```

Observed: `BASELINE ok=20 fail=0`. Sample body (req 1):

```json
{"id":"chatcmpl-c2f72ba2-1aa","object":"chat.completion","created":1788572654,"model":"gpt-4o-mini","choices":[{"index":0,"message":{"role":"assistant","content":"Mock response from openai for model gpt-4o-mini: received 1 message(s). Last prompt length 15 chars."},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":26,"total_tokens":29}}
```

Gateway access-log latencies for the 20 requests ranged 122–393 ms (mock upstream 120–400 ms for openai).

### 3. Routing health + auto-model probe + stream sample

```bash
curl -s -H "Authorization: Bearer $SEED" http://localhost:3220/v1/routing/health
curl -s -X POST http://localhost:3220/v1/chat/completions \
  -H "Authorization: Bearer $SEED" -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"auto route check"}]}'
curl -s -N --max-time 10 -X POST http://localhost:3220/v1/chat/completions \
  -H "Authorization: Bearer $SEED" -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","stream":true,"messages":[{"role":"user","content":"stream hello world"}]}'
```

Observed:

- `GET /v1/routing/health` → 200:
  ```json
  {"object":"routing_health","providers":[
    {"circuit":"closed","id":"openai","ewmaLatencyMs":200,"errorRate":0,"consecutiveFailures":0,"circuitOpen":false,"circuitState":"closed","samples":0,"costPer1k":0.0015},
    {"circuit":"closed","id":"anthropic","ewmaLatencyMs":200,"errorRate":0,"consecutiveFailures":0,"circuitOpen":false,"circuitState":"closed","samples":0,"costPer1k":0.0024},
    {"circuit":"closed","id":"local-vllm","ewmaLatencyMs":200,"errorRate":0,"consecutiveFailures":0,"circuitOpen":false,"circuitState":"closed","samples":0,"costPer1k":0.0002}]}
  ```
- `model=auto` → HTTP 200, but `content` was `"Mock response from anthropic for model gpt-4o-mini..."` — the `auto` alias fans out to all three providers and the routing engine picked anthropic for a `gpt-4o-mini`-labeled request.
- SSE happy path → exit 0, 1296 bytes: `event: infergate.route` (`{"provider":"openai","retry":0}`), 6 data chunks, `data: [DONE]`.
- `GET /readyz` (pre-kill) → 200 `{"ready":true,...}`; unknown model → 400 `model_not_found`.

### 4. Kill -9 mid-stream (provider-outage / crash substitute)

There is no API to force a circuit open (mock `failureRate` is 0 and breakers only open after 5 real failures), so the 503 path (`no_healthy_providers`, `chat.ts:99-105`) is not triggerable live. Crash-fault was tested instead:

```bash
curl -s -N --max-time 15 -X POST http://localhost:3220/v1/chat/completions \
  -H "Authorization: Bearer $SEED" -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","stream":true,"messages":[{"role":"user","content":"kill test..."}]}' \
  -o /tmp/chaos-kill-stream.txt -w "CURL_HTTP:%{http_code} EXIT:%{exitcode} SIZE:%{size_download} TIME:%{time_total}\n" &
sleep 0.15
kill -9 $(lsof -ti tcp:3220 | head -1)
```

Observed:

- `kill -9 exit=0`; gateway PID 86707 gone (`ps` confirms).
- Client: `CURL_HTTP:200 EXIT:18 SIZE:1071 TIME:0.170557` — curl exit **18 (partial transfer)**. Body truncated mid-chunk at 1071 bytes (last bytes: `"choices":[{"ind` — cut inside a JSON chunk, no `[DONE]`, no error event).
- `curl http://localhost:3220/readyz` → `HTTP:000`, curl exit 7 (connection refused).

### 5. Restart + recovery

```bash
API_KEY_PEPPER=chaos-test-pepper-01 PORT=3220 RATE_LIMIT_PER_MINUTE=100000 PRINT_SEED_KEY=1 \
  nohup bun run apps/gateway/src/index.ts > /tmp/chaos-gw2.log 2>&1 &
```

Log output:

```text
{"ts":"2026-09-05T01:44:44.096Z","level":"info","msg":"gateway_boot","port":3220,"orgId":"org_demo"}
{"ts":"2026-09-05T01:44:44.096Z","level":"info","msg":"seed_key","prefix":"anSZ28","orgId":"org_demo"}
SEED_API_KEY=ig_sk_anSZ28_7npNm2eRBEUgjWEHAs51UsmU7npNm2eR
```

Observed:

- Boot-to-ready < 4 s (includes Bun startup; first `/readyz` poll after 4 s sleep already 200).
- `/readyz` ×3: HTTP 200 with `TIME:0.025820`, `0.031144`, `0.010548` s; body `{"ready":true,"providers":{"openai":"ok","anthropic":"ok","local-vllm":"ok"}}`.
- Traffic resumes: 5/5 `POST /v1/chat/completions` → 200 with the **new** seed key (`RESUME ok=5/5`).
- Post-restart `routing/health` shows fresh breaker state (`samples:5` on openai from the 5 resume requests, `samples:0` elsewhere, all `closed`).

### 6. Rate-limit storm (fresh process, default 120/min on :3221)

```bash
API_KEY_PEPPER=chaos-test-pepper-01 PORT=3221 PRINT_SEED_KEY=1 \
  nohup bun run apps/gateway/src/index.ts > /tmp/chaos-gw-3221.log 2>&1 &
# SEED3=ig_sk_YzS2eU_ULygW0dBQc0Rbc7S94HU5cgYULygW0dB
seq 1 150 | xargs -P 20 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:3221/v1/chat/completions \
  -H "Authorization: Bearer $SEED3" -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"storm"}]}' > /tmp/chaos-429-codes.txt
```

Observed (150-request burst, concurrency 20):

- `200`: **123**, `429`: **27**, no other codes, no 5xx.
- 429 body: `{"error":{"message":"Rate limit exceeded","type":"rate_limit_error","code":"rate_limited"}}` (HTTP 429).
- 429 headers: `X-RateLimit-Remaining: 0`, `Retry-After: 1`.
- Note: 123 > 120 capacity because the token bucket refills during the burst (each request holds ~100–400 ms of mock latency, so ~1–2 tokens refill mid-burst). Bucket scope is per API-key + path (`key:{keyId}:{path}` in `middleware/ratelimit.ts`).

### 7. Invalid-key flood (20 requests)

```bash
for i in $(seq 1 20); do
  curl -s -o /tmp/chaos-badkey-$i.json -w "%{http_code}\n" \
    -X POST http://localhost:3220/v1/chat/completions \
    -H "Authorization: Bearer bad-key-$i-invalid" -H "Content-Type: application/json" \
    -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'
done
```

Observed:

- 20/20 → HTTP **401**, 0×5xx.
- Sample: `{"error":{"message":"Malformed API key","type":"authentication_error","code":"invalid_api_key"}}`.
- No-token request → 401 `missing_api_key`; `Bearer not-a-real-key` → 401 `invalid_api_key`.

## Recovery behavior

- Crash (`kill -9`) is total: in-flight SSE is severed with no server-side error frame; the client only sees a truncated stream (curl 18). No resume token is issued.
- Restart is clean and fast: new Bun process binds :3220, `/readyz` 200 within one poll interval, breaker state resets to `closed`, and chat traffic resumes at 5/5 with the fresh seed key.
- Rate limiter degrades gracefully under burst: excess load gets 429 + `Retry-After: 1`, success path unaffected (no 5xx during storm).
- Auth layer fails closed under flood: 401s only, gateway stays healthy for valid keys.

## Gaps found

1. **No fault-injection path for provider outage.** Mock `failureRate` is 0 and breakers need 5 consecutive real failures (`BREAKER_THRESHOLD=5`), so the 503 `no_healthy_providers` branch and the open-circuit routing behavior cannot be exercised via API. Recommend a test-only breaker-trip endpoint or env-driven failure injection (guarded, never in prod).
2. **`/readyz` conflates readiness with provider health.** `app.ts` returns 503 from `/readyz` if *any* provider health check fails. With real upstreams, one provider outage would mark the whole gateway not-ready and invite orchestrators to kill a healthy process. Recommend separate liveness (`/healthz`, already exists) vs readiness (can it serve *any* traffic) vs provider-status signals.
3. **Restart invalidates the previous seed key.** Each boot generates a fresh random seed (`SEED_API_KEY=...` differs per boot: `iXuyPc…` → `anSZ28…`). Any client holding the old key gets 401 after a restart. Key persistence (or stable seed via env/DB) is needed before this is operable.
4. **All state is in-memory.** Keys, usage, idempotency, breaker stats, and rate-limit buckets die with the process (`MemoryKeyStore`, `MemoryUsageStore`, local token bucket). The interrupted stream's usage row is lost entirely on `kill -9` (no `stream_interrupted` record — that only happens on graceful abort). Redis is wired for rate limits/cache but was unset in this run.
5. **Truncated SSE has no client-visible error.** Killed stream ends mid-JSON with curl exit 18 and no SSE error event, so naive clients may treat partial content as complete. Recommend documenting `exit 18 / incomplete [DONE]` handling and/or a stream checksum or terminal-event contract.
6. **Rate limit is per-process, per-key+path.** Without `REDIS_URL`, each replica has its own 120/min bucket (N replicas ≈ N×120 effective). Burst test also showed 123 successes > 120 nominal due to mid-burst refill — expected token-bucket behavior, but load tests should assert a range (e.g. 429s ∈ [20, 40] for a 150-burst), not an exact count.
7. **`auto` alias can serve cross-provider.** Observed `model=auto` (resolved label `gpt-4o-mini`) answered by `anthropic`. If callers assume `model` in the response pins the provider, this will surprise them. The `x-infergate-provider` / `infergate.route` fields are the source of truth — worth calling out in API docs.

## Cleanup

All gateway processes (`:3220` ×2 boots, `:3221`) were killed after the run; no code files were modified.
