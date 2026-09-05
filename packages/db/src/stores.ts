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
  return new Date(value).getTime();
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
    const rows = await this.sql`SELECT * FROM api_keys WHERE prefix = ${prefix} LIMIT 1`;
    if (rows.length === 0) {
      return null;
    }
    return keyFromRow(rows[0] as Record<string, unknown>);
  }

  async findById(id: string): Promise<StoredKey | null> {
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

  async insert(record: Omit<UsageRecord, "id" | "createdAt">): Promise<UsageRecord> {
    if (record.idempotencyKey) {
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
