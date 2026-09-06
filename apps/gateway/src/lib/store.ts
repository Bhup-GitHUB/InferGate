import type { StoredKey } from "@infergate/auth";
import { rollupDaily, type DailyBucket } from "@infergate/billing";

export interface UsageRecord {
  id: string;
  idempotencyKey: string | null;
  orgId: string;
  keyId: string | null;
  providerId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  status: string;
  error: string | null;
  createdAt: number;
  responseBody?: string | null;
  region?: string;
}

export interface KeyStore {
  findByPrefix(prefix: string): Promise<StoredKey | null>;
  findById(id: string): Promise<StoredKey | null>;
  listByOrg(orgId: string): Promise<StoredKey[]>;
  save(key: StoredKey): Promise<void>;
  revoke(id: string, now: number): Promise<void>;
  scheduleRevoke(id: string, at: number): Promise<void>;
  touch(id: string, now: number): Promise<void>;
}

export interface UsageStore {
  insert(record: Omit<UsageRecord, "id" | "createdAt">): Promise<UsageRecord>;
  begin(record: Omit<UsageRecord, "id" | "createdAt" | "status" | "error">): Promise<{ row: UsageRecord; replayed: boolean }>;
  finish(id: string, patch: { providerId?: string | null; model?: string; inputTokens: number; outputTokens: number; latencyMs: number; costUsd: number; status: string; error: string | null; responseBody?: string | null }): Promise<void>;
  remove(id: string): Promise<void>;
  findByIdempotencyKey(orgId: string, key: string): Promise<UsageRecord | null>;
  usageByOrg(orgId: string): Promise<{ requests: number; inputTokens: number; outputTokens: number; costUsd: number }>;
  recordsByOrg(orgId: string, sinceMs: number): Promise<UsageRecord[]>;
  periodUsage(orgId: string, sinceMs: number): Promise<{ tokens: number; spendUsd: number }>;
  recent(orgId: string, limit: number): Promise<UsageRecord[]>;
  daily(orgId: string, days: number, now: number): Promise<DailyBucket[]>;
}

export interface PlanStore {
  get(orgId: string): Promise<string>;
  set(orgId: string, plan: string): Promise<void>;
}

export class OrgPlans implements PlanStore {
  private plans = new Map<string, string>();
  private static valid = new Set(["free", "pro", "enterprise"]);

  async get(orgId: string): Promise<string> {
    return this.plans.get(orgId) ?? "free";
  }

  async set(orgId: string, plan: string): Promise<void> {
    if (!OrgPlans.valid.has(plan)) {
      throw new Error(`Unknown plan: ${plan}`);
    }
    this.plans.set(orgId, plan);
  }
}

export class MemoryKeyStore implements KeyStore {
  private byId = new Map<string, StoredKey>();
  private byPrefix = new Map<string, StoredKey>();

  async findByPrefix(prefix: string): Promise<StoredKey | null> {
    return this.byPrefix.get(prefix) ?? null;
  }

  async findById(id: string): Promise<StoredKey | null> {
    return this.byId.get(id) ?? null;
  }

  async listByOrg(orgId: string): Promise<StoredKey[]> {
    return [...this.byId.values()].filter((k) => k.orgId === orgId);
  }

  async save(key: StoredKey): Promise<void> {
    this.byId.set(key.id, key);
    this.byPrefix.set(key.prefix, key);
  }

  async revoke(id: string, now: number): Promise<void> {
    const key = this.byId.get(id);
    if (key) {
      key.revokedAt = now;
    }
  }

  async scheduleRevoke(id: string, at: number): Promise<void> {
    const key = this.byId.get(id);
    if (key) {
      key.revokedAt = at;
    }
  }

  async touch(id: string, now: number): Promise<void> {
    const key = this.byId.get(id);
    if (key) {
      key.lastUsedAt = now;
    }
  }
}

export class MemoryUsageStore implements UsageStore {
  private records: UsageRecord[] = [];
  private static readonly MAX_ROWS = 50000;

  async insert(record: Omit<UsageRecord, "id" | "createdAt">): Promise<UsageRecord> {
    const row: UsageRecord = { ...record, id: crypto.randomUUID(), createdAt: Date.now() };
    this.records.push(row);
    if (this.records.length > MemoryUsageStore.MAX_ROWS) {
      this.records.splice(0, this.records.length - MemoryUsageStore.MAX_ROWS);
    }
    return row;
  }

  async begin(record: Omit<UsageRecord, "id" | "createdAt" | "status" | "error">): Promise<{ row: UsageRecord; replayed: boolean }> {
    if (record.idempotencyKey) {
      const existing = this.records.find((r) => r.orgId === record.orgId && r.idempotencyKey === record.idempotencyKey);
      if (existing) {
        return { row: existing, replayed: true };
      }
    }
    const row = await this.insert({ ...record, status: "started", error: null });
    return { row, replayed: false };
  }

  async finish(id: string, patch: { providerId?: string | null; model?: string; inputTokens: number; outputTokens: number; latencyMs: number; costUsd: number; status: string; error: string | null; responseBody?: string | null }): Promise<void> {
    const row = this.records.find((r) => r.id === id);
    if (!row) {
      return;
    }
    if (patch.providerId !== undefined) {
      row.providerId = patch.providerId;
    }
    if (patch.model !== undefined) {
      row.model = patch.model;
    }
    row.inputTokens = patch.inputTokens;
    row.outputTokens = patch.outputTokens;
    row.latencyMs = patch.latencyMs;
    row.costUsd = patch.costUsd;
    row.status = patch.status;
    row.error = patch.error;
    if (patch.responseBody !== undefined) {
      row.responseBody = patch.responseBody;
    }
  }

  async remove(id: string): Promise<void> {
    const index = this.records.findIndex((r) => r.id === id);
    if (index >= 0) {
      this.records.splice(index, 1);
    }
  }

  async findByIdempotencyKey(orgId: string, key: string): Promise<UsageRecord | null> {
    return this.records.find((r) => r.orgId === orgId && r.idempotencyKey === key) ?? null;
  }

  async usageByOrg(orgId: string): Promise<{ requests: number; inputTokens: number; outputTokens: number; costUsd: number }> {
    const rows = this.records.filter((r) => r.orgId === orgId && r.status === "ok");
    return {
      requests: rows.length,
      inputTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
      outputTokens: rows.reduce((n, r) => n + r.outputTokens, 0),
      costUsd: rows.reduce((n, r) => n + r.costUsd, 0),
    };
  }

  async recordsByOrg(orgId: string, sinceMs: number): Promise<UsageRecord[]> {
    return this.records.filter((r) => r.orgId === orgId && r.createdAt >= sinceMs);
  }

  async periodUsage(orgId: string, sinceMs: number): Promise<{ tokens: number; spendUsd: number }> {
    const rows = this.records.filter(
      (r) => r.orgId === orgId && r.createdAt >= sinceMs && (r.status === "ok" || r.inputTokens + r.outputTokens > 0),
    );
    return {
      tokens: rows.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0),
      spendUsd: rows.reduce((n, r) => n + r.costUsd, 0),
    };
  }

  async recent(orgId: string, limit: number): Promise<UsageRecord[]> {
    return this.records
      .filter((r) => r.orgId === orgId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.min(Math.max(limit, 1), 100));
  }

  async daily(orgId: string, days: number, now: number): Promise<DailyBucket[]> {
    const rows = this.records.filter((r) => r.orgId === orgId && r.createdAt >= now - days * 86400000);
    return rollupDaily(rows, days, now);
  }
}
