# Observability

## Metrics (`GET /metrics`, Prometheus format)

- `infergate_requests_total{provider,model}` — served requests (streams counted on close).
- `infergate_tokens_total{provider,model}` — input + output tokens.
- `infergate_provider_errors_total{provider}` — upstream failures + mid-stream kills.

Alert thresholds: 5xx > 1% over 5m, p95 > 2s, `provider_errors` spike 3x baseline.

## Tracing

`packages/otel` exposes `startSpan` + `structuredLog`. Gateway emits `gateway.request` timing per request and `gateway.chat` span attributes (orgId, provider, model). OTLP exporter endpoint via `OTEL_EXPORTER_OTLP_ENDPOINT` (Phase 5 wires `@opentelemetry/exporter-trace-otlp-http`; interface is exporter-agnostic).

## Logging

Single-line JSON: `{ts, level, requestId, method, path, status, latencyMs}` plus domain logs (`provider_probe`, `billing_worker_tick`, `seed_key` without secrets). Scrape with Loki/ELK; never log `authorization` or key material (`PRINT_SEED_KEY=1` writes seed to stderr only).

## Dashboards (Phase 6+)

Grafana: request rate, p50/p95 latency, token throughput, error rate by provider, spend by org, breaker state via `/v1/routing/health`.
