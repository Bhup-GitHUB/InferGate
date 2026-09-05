import type { Context, Next } from "hono";
import { structuredLog } from "@infergate/otel";
import type { AppEnv } from "../lib/env";

export function tracingMiddleware() {
  return async (c: Context<AppEnv>, next: Next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    const started = Date.now();
    await next();
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
  };
}
