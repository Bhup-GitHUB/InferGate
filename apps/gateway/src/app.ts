import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createRateLimiter } from "@infergate/ratelimit";
import { getRedis, RedisTokenBucket } from "@infergate/cache";
import { renderPrometheus, structuredLog } from "@infergate/otel";
import { createDefaultRegistry } from "@infergate/providers";
import { RoutingEngine, type RoutingStrategy } from "@infergate/routing";
import { loadConfig } from "./lib/config";
import type { AppEnv } from "./lib/env";
import { MemoryKeyStore, MemoryUsageStore } from "./lib/store";
import { authMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/ratelimit";
import { tracingMiddleware } from "./middleware/tracing";
import { chatRoutes } from "./routes/v1/chat";
import { modelRoutes } from "./routes/v1/models";
import { keyRoutes } from "./routes/v1/keys";
import { usageRoutes } from "./routes/v1/usage";
import { routingRoutes } from "./routes/v1/routing";
import { billingRoutes } from "./routes/v1/billing";
import { schedulerRoutes } from "./routes/v1/scheduler";
import { quotaMiddleware } from "./middleware/quota";
import { webhookRoutes } from "./routes/v1/webhooks";
import { Notifier, WebhookStore } from "./lib/webhooks";
import { OrgPlans } from "./lib/store";

export interface AppHandles {
  app: Hono<AppEnv>;
  keys: MemoryKeyStore;
  usage: MemoryUsageStore;
  routing: RoutingEngine;
  plans: OrgPlans;
  webhooks: WebhookStore;
  notify: Notifier;
}

export function createApp(env: Record<string, string | undefined> = {}): AppHandles {
  const merged: Record<string, string | undefined> = { ...process.env, ...env };
  const config = loadConfig(merged);
  const keys = new MemoryKeyStore();
  const usage = new MemoryUsageStore();
  const plans = new OrgPlans();
  const webhooks = new WebhookStore();
  const notify = new Notifier();
  const registry = createDefaultRegistry();
  const redisClient = getRedis(merged["REDIS_URL"]);
  if (!redisClient && (merged["NODE_ENV"] ?? "development") === "production") {
    console.log(structuredLog({ level: "warn", msg: "redis_unset_rate_limits_local_only" }));
  }
  const routing = new RoutingEngine({
    failureThreshold: config.breakerThreshold,
    cooldownMs: config.breakerCooldownMs,
    backoffBaseMs: 50,
  });
  const strategies: RoutingStrategy[] = ["cost", "latency", "availability", "weighted", "priority"];
  routing.setDefaultStrategy(
    strategies.includes(config.defaultStrategy as RoutingStrategy)
      ? (config.defaultStrategy as RoutingStrategy)
      : "availability",
  );
  routing.registerProvider("openai", { costPer1k: 0.0015, aliases: ["gpt-4o-mini", "gpt-4o", "auto"] });
  routing.registerProvider("anthropic", { costPer1k: 0.0024, aliases: ["claude-3-5-sonnet", "claude-3-haiku", "auto"] });
  routing.registerProvider("local-vllm", { costPer1k: 0.0002, aliases: ["llama-3-8b", "mistral-7b", "auto"] });
  const limiter = redisClient
    ? new RedisTokenBucket(redisClient, config.rateLimitPerMinute, config.rateLimitPerMinute, config.rateLimitFailOpen)
    : createRateLimiter(undefined, {
        capacity: config.rateLimitPerMinute,
        refillPerMinute: config.rateLimitPerMinute,
      });
  const peppers = new Map<number, string>([[config.pepperVersion, config.pepper]]);

  const app = new Hono<AppEnv>();
  app.use("*", tracingMiddleware());
  app.use("*", cors({ origin: config.allowedOrigins }));
  app.use("/v1/*", bodyLimit({ maxSize: config.bodyLimitBytes }));

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", async (c) => {
    const results: Record<string, string> = {};
    for (const info of registry.providers()) {
      const adapter = registry.get(info.id);
      if (!adapter) {
        continue;
      }
      try {
        const status = await adapter.healthCheck();
        results[info.id] = status.ok ? "ok" : "fail";
      } catch {
        results[info.id] = "fail";
      }
    }
    const healthy = Object.values(results).filter((v) => v === "ok");
    if (healthy.length === 0) {
      return c.json({ ready: false, providers: results }, 503);
    }
    return c.json({ ready: true, providers: results });
  });
  app.get("/metrics", (c) => {
    const token = merged["METRICS_TOKEN"];
    if (token) {
      const header = c.req.header("authorization") ?? "";
      if (header !== `Bearer ${token}`) {
        return c.text("forbidden", 403);
      }
    }
    c.header("Content-Type", "text/plain; version=0.0.4");
    return c.text(renderPrometheus());
  });

  const guarded = new Hono<AppEnv>();
  guarded.use("*", authMiddleware(keys, peppers));
  guarded.use("*", rateLimitMiddleware(limiter, config.rateLimitFailOpen));
  guarded.use("*", quotaMiddleware({ usage, plans, webhooks, notify }));
  guarded.route("/", chatRoutes({ registry, routing, usage, config, redis: redisClient, webhooks, notify }));
  guarded.route("/", modelRoutes(registry));
  guarded.route("/", keyRoutes({ keys, config }));
  guarded.route("/", usageRoutes(usage));
  guarded.route("/", billingRoutes({ usage, plans }));
  guarded.route("/", webhookRoutes({ store: webhooks }));
  guarded.route("/", schedulerRoutes());
  guarded.route("/", routingRoutes(routing, registry));
  app.route("/v1", guarded);

  return { app, keys, usage, routing, plans, webhooks, notify };
}
