import type { Context, Next } from "hono";
import { errorBody } from "@infergate/schemas";
import type { RateLimiter } from "@infergate/ratelimit";
import type { AppEnv } from "../lib/env";

export function rateLimitMiddleware(limiter: RateLimiter, failOpen: boolean) {
  return async (c: Context<AppEnv>, next: Next) => {
    const auth = c.get("auth") as AppEnv["Variables"]["auth"] | undefined;
    const bucket = `org:${auth?.orgId ?? "anon"}:${c.req.path}`;
    try {
      const decision = await limiter.check(bucket);
      c.header("X-RateLimit-Remaining", String(decision.remaining));
      if (!decision.allowed) {
        c.header("Retry-After", String(Math.ceil(decision.resetAfterMs / 1000)));
        return c.json(errorBody("Rate limit exceeded", "rate_limit_error", "rate_limited"), 429);
      }
    } catch {
      if (!failOpen) {
        return c.json(errorBody("Rate limiter unavailable", "rate_limit_error", "limiter_unavailable"), 503);
      }
    }
    await next();
  };
}
