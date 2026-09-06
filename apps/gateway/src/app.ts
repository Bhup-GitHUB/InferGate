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
import { MemoryKeyStore, MemoryUsageStore, type KeyStore, type UsageStore } from "./lib/store";
import { createSql, PgKeyStore, PgUsageStore } from "@infergate/db";
import { authMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/ratelimit";
import { tracingMiddleware } from "./middleware/tracing";
import { chatRoutes } from "./routes/v1/chat";
import { embeddingRoutes } from "./routes/v1/embeddings";
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
  keys: KeyStore;
  usage: UsageStore;
  routing: RoutingEngine;
  plans: OrgPlans;
  webhooks: WebhookStore;
  notify: Notifier;
  db: { ping: () => Promise<boolean> } | null;
}

export function createApp(env: Record<string, string | undefined> = {}): AppHandles {
  const merged: Record<string, string | undefined> = { ...process.env, ...env };
  const config = loadConfig(merged);
  let keys: KeyStore = new MemoryKeyStore();
  let usage: UsageStore = new MemoryUsageStore();
  const plans = new OrgPlans();
  const webhooks = new WebhookStore();
  const notify = new Notifier();
  let db: { ping: () => Promise<boolean> } | null = null;
  const databaseUrl = merged["DATABASE_URL"];
  if (databaseUrl) {
    const sql = createSql({ connectionString: databaseUrl, maxConnections: 20, statementTimeoutMs: 5000 });
    const pgUsage = new PgUsageStore(sql);
    keys = new PgKeyStore(sql);
    usage = pgUsage;
    db = pgUsage;
  }
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
    let dbStatus: string | null = null;
    if (db) {
      dbStatus = (await db.ping()) ? "ok" : "fail";
    }
    if (healthy.length === 0 || dbStatus === "fail") {
      return c.json({ ready: false, providers: results, db: dbStatus ?? "unconfigured" }, 503);
    }
    return c.json({ ready: true, providers: results, db: dbStatus ?? "unconfigured" });
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
  guarded.route("/", embeddingRoutes());
  guarded.route("/", modelRoutes(registry));
  guarded.route("/", keyRoutes({ keys, config }));
  guarded.route("/", usageRoutes(usage));
  guarded.route("/", billingRoutes({ usage, plans }));
  guarded.route("/", webhookRoutes({ store: webhooks, notify }));
  guarded.route("/", schedulerRoutes());
  guarded.route("/", routingRoutes(routing, registry));
  app.route("/v1", guarded);

  return { app, keys, usage, routing, plans, webhooks, notify, db };
}
