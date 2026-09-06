import postgres from "postgres";
import type { StoredKey } from "@infergate/auth";
import type { KeyStore, UsageRecord, UsageStore } from "../../../apps/gateway/src/lib/store";

export interface PgConfig {
  connectionString: string;
  maxConnections: number;
  statementTimeoutMs: number;
}

export type Sql = ReturnType<typeof postgres>;

export function createSql(config: PgConfig): Sql {
  return postgres(config.connectionString, {
    max: config.maxConnections,
    connect_timeout: 5,
  });
}

function toMs(value: Date | string | null): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function keyFromRow(row: Record<string, unknown>): StoredKey {
  return {
    id: row["id"] as string,
    orgId: row["org_id"] as string,
    prefix: row["prefix"] as string,
    salt: row["salt"] as string,
    hashedSecret: row["hashed_secret"] as string,
    pepperVersion: row["pepper_version"] as number,
    scopes: row["scopes"] as string[],
    expiresAt: toMs(row["expires_at"] as Date | null),
    rotatedFromId: row["rotated_from_id"] as string | null,
    revokedAt: toMs(row["revoked_at"] as Date | null),
    createdAt: toMs(row["created_at"] as Date) as number,
  };
}

const toTs = (ms: number | null): Date | null => (ms === null ? null : new Date(ms));

export class PgKeyStore implements KeyStore {
  constructor(private sql: Sql) {}

  async findByPrefix(prefix: string): Promise<StoredKey | null> {
    if (prefix.length > 64) {
      return null;
    }
    const rows = await this.sql`SELECT * FROM api_keys WHERE prefix = ${prefix} LIMIT 1`;
    if (rows.length === 0) {
      return null;
    }
    return keyFromRow(rows[0] as Record<string, unknown>);
  }

  async findById(id: string): Promise<StoredKey | null> {
    if (!isUuid(id)) {
      return null;
    }
    const rows = await this.sql`SELECT * FROM api_keys WHERE id = ${id} LIMIT 1`;
    if (rows.length === 0) {
      return null;
    }
    return keyFromRow(rows[0] as Record<string, unknown>);
  }

  async save(key: StoredKey): Promise<void> {
    await this.sql`
      INSERT INTO api_keys (id, org_id, prefix, salt, hashed_secret, pepper_version, scopes, expires_at, rotated_from_id, revoked_at, created_at)
      VALUES (${key.id}, ${key.orgId}, ${key.prefix}, ${key.salt}, ${key.hashedSecret}, ${key.pepperVersion}, ${key.scopes}, ${toTs(key.expiresAt)}, ${key.rotatedFromId}, ${toTs(key.revokedAt)}, ${toTs(key.createdAt) ?? new Date()})
      ON CONFLICT (id) DO UPDATE SET revoked_at = EXCLUDED.revoked_at, expires_at = EXCLUDED.expires_at
    `;
  }

  async revoke(id: string, now: number): Promise<void> {
    await this.sql`UPDATE api_keys SET revoked_at = ${toTs(now)} WHERE id = ${id}`;
  }

  async scheduleRevoke(id: string, at: number): Promise<void> {
    await this.sql`UPDATE api_keys SET revoked_at = ${toTs(at)} WHERE id = ${id}`;
  }
}

export interface StoredRule {
  id: string;
  orgId: string | null;
  modelAlias: string;
  strategy: string;
  weights: Record<string, number>;
  priority: string[];
  maxAttempts: number;
}

export class PgRuleStore {
  constructor(private sql: Sql) {}

  async list(orgId: string): Promise<StoredRule[]> {
    const rows = await this.sql`
      SELECT * FROM routing_rules WHERE org_id IS NULL OR org_id = ${orgId} ORDER BY priority DESC
    `;
    return rows.map((r) => ruleFromRow(r as Record<string, unknown>));
  }

  async create(rule: Omit<StoredRule, "id">): Promise<StoredRule> {
    const rows = await this.sql`
      INSERT INTO routing_rules (org_id, model_alias, strategy, config, priority)
      VALUES (${rule.orgId}, ${rule.modelAlias}, ${rule.strategy}, ${JSON.stringify({ weights: rule.weights, priority: rule.priority, maxAttempts: rule.maxAttempts })}, 0)
      RETURNING *
    `;
    return ruleFromRow(rows[0] as Record<string, unknown>);
  }

  async remove(orgId: string, id: string): Promise<boolean> {
    if (!isUuid(id)) {
      return false;
    }
    const rows = await this.sql`
      DELETE FROM routing_rules WHERE id = ${id} AND org_id = ${orgId} RETURNING id
    `;
    return rows.length > 0;
  }
}

function ruleFromRow(row: Record<string, unknown>): StoredRule {  const config = (row["config"] ?? {}) as { weights?: Record<string, number>; priority?: string[]; maxAttempts?: number };
  return {
    id: row["id"] as string,
    orgId: row["org_id"] as string | null,
    modelAlias: row["model_alias"] as string,
    strategy: row["strategy"] as string,
    weights: config.weights ?? {},
    priority: config.priority ?? [],
    maxAttempts: config.maxAttempts ?? 3,
  };
}

function usageFromRow(row: Record<string, unknown>): UsageRecord {
  return {
    id: row["id"] as string,
    idempotencyKey: row["idempotency_key"] as string | null,
    orgId: row["org_id"] as string,
    keyId: row["key_id"] as string | null,
    providerId: row["provider_id"] as string | null,
    model: row["model"] as string,
    inputTokens: row["input_tokens"] as number,
    outputTokens: row["output_tokens"] as number,
    latencyMs: row["latency_ms"] as number,
    costUsd: Number(row["cost_usd"]),
    status: row["status"] as string,
    error: row["error"] as string | null,
    createdAt: new Date(row["created_at"] as Date).getTime(),
  };
}

export class PgUsageStore implements UsageStore {
  constructor(private sql: Sql) {}

  async insert(record: Omit<UsageRecord, "id" | "createdAt">): Promise<UsageRecord> {    if (record.idempotencyKey) {
      const existing = await this.sql`
        SELECT * FROM requests WHERE org_id = ${record.orgId} AND idempotency_key = ${record.idempotencyKey} LIMIT 1
      `;
      if (existing.length > 0) {
        return usageFromRow(existing[0] as Record<string, unknown>);
      }
    }
    const rows = await this.sql`
      INSERT INTO requests (idempotency_key, org_id, key_id, provider_id, model, input_tokens, output_tokens, latency_ms, cost_usd, status, error)
      VALUES (${record.idempotencyKey}, ${record.orgId}, ${record.keyId}, ${record.providerId}, ${record.model}, ${record.inputTokens}, ${record.outputTokens}, ${record.latencyMs}, ${String(record.costUsd)}, ${record.status}, ${record.error})
      ON CONFLICT (org_id, idempotency_key) DO NOTHING
      RETURNING *
    `;
    if (rows.length > 0) {
      return usageFromRow(rows[0] as Record<string, unknown>);
    }
    const raced = await this.sql`
      SELECT * FROM requests WHERE org_id = ${record.orgId} AND idempotency_key = ${record.idempotencyKey} LIMIT 1
    `;
    return usageFromRow(raced[0] as Record<string, unknown>);
  }

  async begin(record: Omit<UsageRecord, "id" | "createdAt" | "status" | "error">): Promise<{ row: UsageRecord; replayed: boolean }> {
    if (record.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(record.orgId, record.idempotencyKey);
      if (existing) {
        return { row: existing, replayed: true };
      }
      const rows = await this.sql`
        INSERT INTO requests (idempotency_key, org_id, key_id, provider_id, model, input_tokens, output_tokens, latency_ms, cost_usd, status, error)
        VALUES (${record.idempotencyKey}, ${record.orgId}, ${record.keyId}, ${record.providerId}, ${record.model}, 0, 0, 0, '0', 'started', NULL)
        ON CONFLICT (org_id, idempotency_key) DO NOTHING
        RETURNING *
      `;
      if (rows.length === 0) {
        const raced = await this.findByIdempotencyKey(record.orgId, record.idempotencyKey);
        return { row: raced as UsageRecord, replayed: true };
      }
      return { row: usageFromRow(rows[0] as Record<string, unknown>), replayed: false };
    }
    const started = await this.insert({ ...record, status: "started", error: null });
    return { row: started, replayed: false };
  }

  async finish(id: string, patch: { providerId?: string | null; model?: string; inputTokens: number; outputTokens: number; latencyMs: number; costUsd: number; status: string; error: string | null }): Promise<void> {
    await this.sql`
      UPDATE requests
      SET provider_id = COALESCE(${patch.providerId ?? null}, provider_id),
          model = COALESCE(${patch.model ?? null}, model),
          input_tokens = ${patch.inputTokens}, output_tokens = ${patch.outputTokens},
          latency_ms = ${patch.latencyMs}, cost_usd = ${String(patch.costUsd)},
          status = ${patch.status}, error = ${patch.error}
      WHERE id = ${id}
    `;
  }

  async remove(id: string): Promise<void> {
    await this.sql`DELETE FROM requests WHERE id = ${id}`;
  }

  async findByIdempotencyKey(orgId: string, key: string): Promise<UsageRecord | null> {
    const rows = await this.sql`
      SELECT * FROM requests WHERE org_id = ${orgId} AND idempotency_key = ${key} LIMIT 1
    `;
    if (rows.length === 0) {
      return null;
    }
    return usageFromRow(rows[0] as Record<string, unknown>);
  }

  async usageByOrg(orgId: string): Promise<{ requests: number; inputTokens: number; outputTokens: number; costUsd: number }> {
    const rows = await this.sql`
      SELECT COUNT(*)::int AS requests, COALESCE(SUM(input_tokens),0)::int AS input_tokens,
             COALESCE(SUM(output_tokens),0)::int AS output_tokens, COALESCE(SUM(cost_usd),0)::float AS cost_usd
      FROM requests WHERE org_id = ${orgId} AND status = 'ok'
    `;
    const r = rows[0] as unknown as { requests: number; input_tokens: number; output_tokens: number; cost_usd: number };
    return { requests: r.requests, inputTokens: r.input_tokens, outputTokens: r.output_tokens, costUsd: r.cost_usd };
  }

  async recordsByOrg(orgId: string, sinceMs: number): Promise<UsageRecord[]> {
    const rows = await this.sql`
      SELECT * FROM requests WHERE org_id = ${orgId} AND created_at >= ${toTs(sinceMs)} ORDER BY created_at ASC
    `;
    return rows.map((r) => usageFromRow(r as Record<string, unknown>));
  }

  async periodUsage(orgId: string, sinceMs: number): Promise<{ tokens: number; spendUsd: number }> {
    const rows = await this.sql`
      SELECT COALESCE(SUM(input_tokens + output_tokens),0)::int AS tokens, COALESCE(SUM(cost_usd),0)::float AS spend
      FROM requests WHERE org_id = ${orgId} AND created_at >= ${toTs(sinceMs)}
        AND (status = 'ok' OR input_tokens + output_tokens > 0)
    `;
    const r = rows[0] as unknown as { tokens: number; spend: number };
    return { tokens: r.tokens, spendUsd: r.spend };
  }

  async recent(orgId: string, limit: number): Promise<UsageRecord[]> {
    const rows = await this.sql`
      SELECT * FROM requests WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT ${Math.min(Math.max(limit, 1), 100)}
    `;
    return rows.map((r) => usageFromRow(r as Record<string, unknown>));
  }

  async ping(): Promise<boolean> {
    try {
      await this.sql`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

const VALID_PLANS = new Set(["free", "pro", "enterprise"]);

export class PgPlanStore {
  constructor(private sql: Sql) {}

  async get(orgId: string): Promise<string> {
    const rows = await this.sql`SELECT plan FROM organizations WHERE id = ${orgId} LIMIT 1`;
    if (rows.length === 0) {
      return "free";
    }
    const plan = (rows[0] as Record<string, unknown>)["plan"] as string;
    return VALID_PLANS.has(plan) ? plan : "free";
  }

  async set(orgId: string, plan: string): Promise<void> {
    if (!VALID_PLANS.has(plan)) {
      throw new Error(`Unknown plan: ${plan}`);
    }
    await this.sql`
      INSERT INTO organizations (id, name, plan) VALUES (${orgId}, 'org', ${plan})
      ON CONFLICT (id) DO UPDATE SET plan = EXCLUDED.plan
    `;
  }
}

export interface StoredWebhook {
  id: string;
  orgId: string;
  url: string;
  secret: string;
  events: string[];
}

export class PgWebhookStore {
  constructor(private sql: Sql) {}

  async add(orgId: string, url: string, secret: string, events: string[]): Promise<StoredWebhook> {
    const rows = await this.sql`
      INSERT INTO webhooks (org_id, url, secret, events)
      VALUES (${orgId}, ${url}, ${secret}, ${events})
      RETURNING *
    `;
    return webhookFromRow(rows[0] as Record<string, unknown>);
  }

  async list(orgId: string): Promise<StoredWebhook[]> {
    const rows = await this.sql`SELECT * FROM webhooks WHERE org_id = ${orgId} ORDER BY created_at DESC`;
    return rows.map((r) => webhookFromRow(r as Record<string, unknown>));
  }

  async remove(orgId: string, id: string): Promise<boolean> {
    if (!isUuid(id)) {
      return false;
    }
    const rows = await this.sql`DELETE FROM webhooks WHERE id = ${id} AND org_id = ${orgId} RETURNING id`;
    return rows.length > 0;
  }
}

function webhookFromRow(row: Record<string, unknown>): StoredWebhook {
  return {
    id: row["id"] as string,
    orgId: row["org_id"] as string,
    url: row["url"] as string,
    secret: row["secret"] as string,
    events: row["events"] as string[],
  };
}
