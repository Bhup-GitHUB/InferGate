import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: text("role").notNull().default("member"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  prefix: text("prefix").notNull().unique(),
  salt: text("salt").notNull(),
  hashedSecret: text("hashed_secret").notNull(),
  pepperVersion: integer("pepper_version").notNull().default(1),
  scopes: text("scopes").array().notNull().default(["chat:write", "models:read"]),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  rotatedFromId: uuid("rotated_from_id"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providers = pgTable("providers", {
  id: text("id").primaryKey(),
  baseUrl: text("base_url").notNull(),
  kind: text("kind").notNull().default("mock"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const models = pgTable("models", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull().references(() => providers.id),
  alias: text("alias").notNull().unique(),
  inputPrice1k: numeric("input_price_1k").notNull().default("0"),
  outputPrice1k: numeric("output_price_1k").notNull().default("0"),
  contextWindow: integer("context_window").notNull().default(128000),
  enabled: boolean("enabled").notNull().default(true),
});

export const routingRules = pgTable("routing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id),
  modelAlias: text("model_alias").notNull(),
  strategy: text("strategy").notNull().default("availability"),
  config: jsonb("config").notNull().default({}),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const requests = pgTable("requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  idempotencyKey: text("idempotency_key"),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  keyId: uuid("key_id").references(() => apiKeys.id),
  providerId: text("provider_id"),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  costUsd: numeric("cost_usd").notNull().default("0"),
  status: text("status").notNull().default("ok"),
  error: text("error"),
  responseBody: text("response_body"),
  region: text("region").notNull().default("home"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("idx_requests_org_idempotency").on(t.orgId, t.idempotencyKey)]);

export const usageDaily = pgTable(
  "usage_daily",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    date: text("date").notNull(),
    model: text("model").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    costUsd: numeric("cost_usd").notNull().default("0"),
    requests: bigint("requests", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.date, t.model] })],
);

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  amountUsd: numeric("amount_usd").notNull().default("0"),
  status: text("status").notNull().default("draft"),
});

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
