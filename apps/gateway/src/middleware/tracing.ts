import type { Context, Next } from "hono";
import { structuredLog } from "@infergate/otel";
import type { AppEnv } from "../lib/env";

let inflightRequests = 0;
let draining = false;

export function inflightCount(): number {
  return inflightRequests;
}

export function isDraining(): boolean {
  return draining;
}

export function beginDrain(): void {
  draining = true;
}

export function tracingMiddleware() {
  return async (c: Context<AppEnv>, next: Next) => {
    if (draining && c.req.path !== "/healthz") {
      return c.text("draining", 503);
    }
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    c.header("X-InferGate-Version", "0.1.0");
    const started = Date.now();
    inflightRequests += 1;
    try {
      await next();
    } finally {
      inflightRequests -= 1;
    }
    const latencyMs = Date.now() - started;
    const line = structuredLog({
      level: "info",
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      latencyMs,
    });
    console.log(line);
    try {
      const contentType = c.res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        c.header("Server-Timing", `gateway;dur=${latencyMs}`);
      }
    } catch {
      return;
    }
  };
}
