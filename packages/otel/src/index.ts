import { context, trace, type Span as OtelSpan } from "@opentelemetry/api";

export interface Span {
  setAttribute(key: string, value: string | number): void;
  recordError(message: string): void;
  end(): void;
}

export interface Metrics {
  requestsTotal: Map<string, number>;
  tokensTotal: Map<string, number>;
  providerErrors: Map<string, number>;
  costTotal: Map<string, number>;
  latencies: number[];
}

function newMetrics(): Metrics {
  return {
    requestsTotal: new Map(),
    tokensTotal: new Map(),
    providerErrors: new Map(),
    costTotal: new Map(),
    latencies: [],
  };
}

export const metrics: Metrics = newMetrics();

const tracer = trace.getTracer("infergate-gateway", "0.1.0");

class OtelSpanWrapper implements Span {
  constructor(private span: OtelSpan) {}

  setAttribute(key: string, value: string | number): void {
    this.span.setAttribute(key, value);
  }

  recordError(message: string): void {
    this.span.recordException(new Error(message));
  }

  end(): void {
    this.span.end();
  }
}

export function startSpan(name: string): Span {
  const span = tracer.startSpan(name, undefined, context.active());
  return new OtelSpanWrapper(span);
}

export function observeRequest(provider: string, model: string, latencyMs: number, inputTokens: number, outputTokens: number, costUsd: number): void {
  const rk = `${provider}|||${model}`;
  metrics.requestsTotal.set(rk, (metrics.requestsTotal.get(rk) ?? 0) + 1);
  metrics.tokensTotal.set(rk, (metrics.tokensTotal.get(rk) ?? 0) + inputTokens + outputTokens);
  metrics.costTotal.set(rk, (metrics.costTotal.get(rk) ?? 0) + costUsd);
  metrics.latencies.push(latencyMs);
  if (metrics.latencies.length > 1000) {
    metrics.latencies.splice(0, metrics.latencies.length - 1000);
  }
}

export function observeProviderError(provider: string): void {
  metrics.providerErrors.set(provider, (metrics.providerErrors.get(provider) ?? 0) + 1);
}

function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function renderPrometheus(): string {
  const lines: string[] = [];
  lines.push("# HELP infergate_requests_total Total gateway requests");
  lines.push("# TYPE infergate_requests_total counter");
  for (const [k, v] of metrics.requestsTotal) {
    const [provider, model] = k.split("|||");
    lines.push(`infergate_requests_total{provider="${esc(provider)}",model="${esc(model)}"} ${v}`);
  }
  lines.push("# HELP infergate_tokens_total Total tokens");
  lines.push("# TYPE infergate_tokens_total counter");
  for (const [k, v] of metrics.tokensTotal) {
    const [provider, model] = k.split("|||");
    lines.push(`infergate_tokens_total{provider="${esc(provider)}",model="${esc(model)}"} ${v}`);
  }
  lines.push("# HELP infergate_provider_errors_total Provider errors");
  lines.push("# TYPE infergate_provider_errors_total counter");
  for (const [k, v] of metrics.providerErrors) {
    lines.push(`infergate_provider_errors_total{provider="${esc(k)}"} ${v}`);
  }
  return lines.join("\n") + "\n";
}

export function structuredLog(fields: Record<string, unknown>): string {
  const span = trace.getSpan(context.active());
  const traceId = span ? span.spanContext().traceId : undefined;
  if (traceId && traceId !== "00000000000000000000000000000000") {
    return JSON.stringify({ ts: new Date().toISOString(), traceId, ...fields });
  }
  return JSON.stringify({ ts: new Date().toISOString(), ...fields });
}
